#![forbid(unsafe_code)]

use std::path::{Component, Path, PathBuf};
use thiserror::Error;
use tokio::{
    fs,
    io::{AsyncRead, AsyncReadExt, AsyncWriteExt},
};
use uuid::Uuid;
use zipship_domain::ArtifactDigest;

#[derive(Debug, Clone)]
pub struct LocalArtifactStore {
    root: PathBuf,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CommitOutcome {
    Created,
    AlreadyExists,
}

#[derive(Debug, Error)]
pub enum StorageError {
    #[error("storage operation failed: {0}")]
    Io(#[from] std::io::Error),
    #[error("staging directory is outside the configured storage root")]
    InvalidStagingPath,
    #[error("staging path is not a directory")]
    InvalidStagingDirectory,
    #[error("artifact asset path is unsafe")]
    InvalidArtifactPath,
    #[error("artifact root is not a regular directory")]
    InvalidArtifactDirectory,
    #[error("artifact asset is not a regular file")]
    InvalidArtifactFile,
    #[error("upload contained more bytes than declared: expected {expected}")]
    UploadTooLarge { expected: u64 },
    #[error(
        "upload byte count did not match declaration: expected {expected}, received {received}"
    )]
    UploadSizeMismatch { expected: u64, received: u64 },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UploadWriteResult {
    pub path: PathBuf,
    pub bytes_written: u64,
}

impl LocalArtifactStore {
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self { root: root.into() }
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn staging_root(&self) -> PathBuf {
        self.root.join("staging")
    }

    pub fn blob_root(&self) -> PathBuf {
        self.root.join("blobs").join("sha256")
    }

    pub fn trash_root(&self) -> PathBuf {
        self.root.join("trash")
    }

    pub fn upload_staging_path(&self, upload_id: Uuid) -> PathBuf {
        self.staging_root()
            .join("uploads")
            .join(upload_id.to_string())
    }

    pub fn upload_archive_path(&self, upload_id: Uuid) -> PathBuf {
        self.upload_staging_path(upload_id).join("archive.zip")
    }

    pub fn artifact_work_path(&self, upload_id: Uuid, job_id: Uuid, attempt: i32) -> PathBuf {
        self.upload_staging_path(upload_id)
            .join(format!("expanded-{job_id}-{attempt}"))
    }

    pub fn upload_staging_key(upload_id: Uuid) -> String {
        format!("uploads/{upload_id}/archive.zip")
    }

    pub fn artifact_path(&self, digest: &ArtifactDigest) -> PathBuf {
        let digest = digest.as_str();
        self.blob_root()
            .join(&digest[0..2])
            .join(&digest[2..4])
            .join(digest)
    }

    pub fn artifact_storage_key(digest: &ArtifactDigest) -> String {
        let digest = digest.as_str();
        format!(
            "blobs/sha256/{}/{}/{}",
            &digest[0..2],
            &digest[2..4],
            digest
        )
    }

    pub async fn ensure_layout(&self) -> Result<(), StorageError> {
        for path in [self.staging_root(), self.blob_root(), self.trash_root()] {
            fs::create_dir_all(path).await?;
        }
        Ok(())
    }

    pub async fn check_health(&self) -> Result<(), StorageError> {
        for path in [self.staging_root(), self.blob_root(), self.trash_root()] {
            if !fs::metadata(path).await?.is_dir() {
                return Err(StorageError::InvalidStagingDirectory);
            }
        }
        Ok(())
    }

    pub async fn open_artifact_file(
        &self,
        digest: &ArtifactDigest,
        asset_path: &str,
    ) -> Result<fs::File, StorageError> {
        let components = regular_path_components(asset_path)?;
        let artifact_root = self.artifact_path(digest);
        let root_metadata = fs::symlink_metadata(&artifact_root).await?;
        if !root_metadata.file_type().is_dir() || root_metadata.file_type().is_symlink() {
            return Err(StorageError::InvalidArtifactDirectory);
        }

        let mut current = artifact_root;
        for (index, component) in components.iter().enumerate() {
            current.push(component);
            let metadata = fs::symlink_metadata(&current).await?;
            let final_component = index + 1 == components.len();
            let valid = if final_component {
                metadata.file_type().is_file() && !metadata.file_type().is_symlink()
            } else {
                metadata.file_type().is_dir() && !metadata.file_type().is_symlink()
            };
            if !valid {
                return Err(if final_component {
                    StorageError::InvalidArtifactFile
                } else {
                    StorageError::InvalidArtifactDirectory
                });
            }
        }

        let file = fs::OpenOptions::new().read(true).open(current).await?;
        if !file.metadata().await?.is_file() {
            return Err(StorageError::InvalidArtifactFile);
        }
        Ok(file)
    }

    pub async fn commit_artifact_directory(
        &self,
        staging_directory: &Path,
        digest: &ArtifactDigest,
    ) -> Result<CommitOutcome, StorageError> {
        let staging_root = fs::canonicalize(self.staging_root()).await?;
        let staging_directory = fs::canonicalize(staging_directory).await?;
        if !staging_directory.starts_with(&staging_root) {
            return Err(StorageError::InvalidStagingPath);
        }
        if !fs::metadata(&staging_directory).await?.is_dir() {
            return Err(StorageError::InvalidStagingDirectory);
        }

        let destination = self.artifact_path(digest);
        match fs::symlink_metadata(&destination).await {
            Ok(metadata) if metadata.file_type().is_dir() && !metadata.file_type().is_symlink() => {
                fs::remove_dir_all(staging_directory).await?;
                return Ok(CommitOutcome::AlreadyExists);
            }
            Ok(_) => return Err(StorageError::InvalidStagingDirectory),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.into()),
        }

        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent).await?;
        }
        fs::rename(staging_directory, destination).await?;
        sync_directory_if_supported(
            self.artifact_path(digest)
                .parent()
                .expect("artifact path always has a parent"),
        )
        .await?;
        Ok(CommitOutcome::Created)
    }

    pub async fn write_upload_stream<R>(
        &self,
        upload_id: Uuid,
        transfer_id: Uuid,
        mut reader: R,
        expected_size: u64,
    ) -> Result<UploadWriteResult, StorageError>
    where
        R: AsyncRead + Unpin,
    {
        let upload_directory = self.upload_staging_path(upload_id);
        fs::create_dir_all(&upload_directory).await?;
        let temporary_path = upload_directory.join(format!("{transfer_id}.part"));
        let final_path = self.upload_archive_path(upload_id);
        let mut file = fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temporary_path)
            .await?;

        let write_result = async {
            let mut total = 0_u64;
            let mut buffer = vec![0_u8; 64 * 1_024];
            loop {
                let read = reader.read(&mut buffer).await?;
                if read == 0 {
                    break;
                }
                total = total
                    .checked_add(read as u64)
                    .ok_or(StorageError::UploadTooLarge {
                        expected: expected_size,
                    })?;
                if total > expected_size {
                    return Err(StorageError::UploadTooLarge {
                        expected: expected_size,
                    });
                }
                file.write_all(&buffer[..read]).await?;
            }
            if total != expected_size {
                return Err(StorageError::UploadSizeMismatch {
                    expected: expected_size,
                    received: total,
                });
            }
            file.flush().await?;
            file.sync_all().await?;
            Ok(total)
        }
        .await;

        drop(file);
        let total = match write_result {
            Ok(total) => total,
            Err(error) => {
                let _ = fs::remove_file(&temporary_path).await;
                return Err(error);
            }
        };

        if fs::try_exists(&final_path).await? {
            fs::remove_file(&final_path).await?;
        }
        if let Err(error) = fs::rename(&temporary_path, &final_path).await {
            let _ = fs::remove_file(&temporary_path).await;
            return Err(error.into());
        }

        Ok(UploadWriteResult {
            path: final_path,
            bytes_written: total,
        })
    }

    pub async fn remove_upload_staging(&self, upload_id: Uuid) -> Result<(), StorageError> {
        let path = self.upload_staging_path(upload_id);
        if fs::try_exists(&path).await? {
            fs::remove_dir_all(path).await?;
        }
        Ok(())
    }
}

fn regular_path_components(asset_path: &str) -> Result<Vec<&std::ffi::OsStr>, StorageError> {
    if asset_path.is_empty() || asset_path.contains(['\\', '\0']) {
        return Err(StorageError::InvalidArtifactPath);
    }
    let components = Path::new(asset_path)
        .components()
        .map(|component| match component {
            Component::Normal(value) => Ok(value),
            _ => Err(StorageError::InvalidArtifactPath),
        })
        .collect::<Result<Vec<_>, _>>()?;
    if components.is_empty() {
        return Err(StorageError::InvalidArtifactPath);
    }
    Ok(components)
}

#[cfg(unix)]
async fn sync_directory_if_supported(path: &Path) -> Result<(), std::io::Error> {
    fs::File::open(path).await?.sync_all().await
}

#[cfg(not(unix))]
async fn sync_directory_if_supported(_path: &Path) -> Result<(), std::io::Error> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn digest() -> ArtifactDigest {
        ArtifactDigest::parse("0123456789abcdef".repeat(4)).unwrap()
    }

    #[tokio::test]
    async fn creates_the_storage_layout() {
        let temp = tempdir().unwrap();
        let storage = LocalArtifactStore::new(temp.path());
        storage.ensure_layout().await.unwrap();
        storage.check_health().await.unwrap();
    }

    #[tokio::test]
    async fn maps_full_hashes_to_sharded_blob_paths() {
        let temp = tempdir().unwrap();
        let storage = LocalArtifactStore::new(temp.path());
        let path = storage.artifact_path(&digest());
        assert!(path.ends_with(Path::new(
            "blobs/sha256/01/23/0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        )));
        assert_eq!(
            LocalArtifactStore::artifact_storage_key(&digest()),
            "blobs/sha256/01/23/0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        );
    }

    #[tokio::test]
    async fn atomically_commits_a_staging_directory_without_overwriting() {
        let temp = tempdir().unwrap();
        let storage = LocalArtifactStore::new(temp.path());
        storage.ensure_layout().await.unwrap();

        let first = storage.upload_staging_path(Uuid::new_v4()).join("expanded");
        fs::create_dir_all(&first).await.unwrap();
        fs::write(first.join("index.html"), "first").await.unwrap();
        assert_eq!(
            storage
                .commit_artifact_directory(&first, &digest())
                .await
                .unwrap(),
            CommitOutcome::Created,
        );

        let duplicate = storage.upload_staging_path(Uuid::new_v4()).join("expanded");
        fs::create_dir_all(&duplicate).await.unwrap();
        fs::write(duplicate.join("index.html"), "second")
            .await
            .unwrap();
        assert_eq!(
            storage
                .commit_artifact_directory(&duplicate, &digest())
                .await
                .unwrap(),
            CommitOutcome::AlreadyExists,
        );

        assert_eq!(
            fs::read_to_string(storage.artifact_path(&digest()).join("index.html"))
                .await
                .unwrap(),
            "first",
        );
    }

    #[tokio::test]
    async fn refuses_to_commit_a_directory_outside_staging() {
        let temp = tempdir().unwrap();
        let storage = LocalArtifactStore::new(temp.path().join("store"));
        storage.ensure_layout().await.unwrap();
        let outside = temp.path().join("outside");
        fs::create_dir_all(&outside).await.unwrap();

        assert!(matches!(
            storage.commit_artifact_directory(&outside, &digest()).await,
            Err(StorageError::InvalidStagingPath),
        ));
    }

    #[tokio::test]
    async fn streams_exact_uploads_to_a_stable_archive_path() {
        let temp = tempdir().unwrap();
        let storage = LocalArtifactStore::new(temp.path());
        storage.ensure_layout().await.unwrap();
        let upload_id = Uuid::new_v4();
        let contents = b"PK\x03\x04zip payload".to_vec();

        let result = storage
            .write_upload_stream(
                upload_id,
                Uuid::new_v4(),
                std::io::Cursor::new(contents.clone()),
                contents.len() as u64,
            )
            .await
            .unwrap();
        assert_eq!(result.path, storage.upload_archive_path(upload_id));
        assert_eq!(result.bytes_written, contents.len() as u64);
        assert_eq!(fs::read(result.path).await.unwrap(), contents);
        assert_eq!(
            LocalArtifactStore::upload_staging_key(upload_id),
            format!("uploads/{upload_id}/archive.zip"),
        );
    }

    #[tokio::test]
    async fn removes_partial_files_when_the_body_is_short_or_oversized() {
        let temp = tempdir().unwrap();
        let storage = LocalArtifactStore::new(temp.path());
        storage.ensure_layout().await.unwrap();

        for (contents, expected) in [(b"short".as_slice(), 10_u64), (b"too long".as_slice(), 3)] {
            let upload_id = Uuid::new_v4();
            let result = storage
                .write_upload_stream(
                    upload_id,
                    Uuid::new_v4(),
                    std::io::Cursor::new(contents),
                    expected,
                )
                .await;
            assert!(matches!(
                result,
                Err(StorageError::UploadSizeMismatch { .. })
                    | Err(StorageError::UploadTooLarge { .. })
            ));
            assert!(
                !fs::try_exists(storage.upload_archive_path(upload_id))
                    .await
                    .unwrap()
            );
            let mut entries = fs::read_dir(storage.upload_staging_path(upload_id))
                .await
                .unwrap();
            assert!(entries.next_entry().await.unwrap().is_none());
        }
    }

    #[tokio::test]
    async fn a_retry_replaces_an_unfinalized_archive() {
        let temp = tempdir().unwrap();
        let storage = LocalArtifactStore::new(temp.path());
        storage.ensure_layout().await.unwrap();
        let upload_id = Uuid::new_v4();

        for contents in [b"first".as_slice(), b"retry".as_slice()] {
            storage
                .write_upload_stream(
                    upload_id,
                    Uuid::new_v4(),
                    std::io::Cursor::new(contents),
                    contents.len() as u64,
                )
                .await
                .unwrap();
        }
        assert_eq!(
            fs::read(storage.upload_archive_path(upload_id))
                .await
                .unwrap(),
            b"retry",
        );
    }

    #[tokio::test]
    async fn opens_only_regular_files_beneath_an_artifact_root() {
        let temp = tempdir().unwrap();
        let storage = LocalArtifactStore::new(temp.path());
        storage.ensure_layout().await.unwrap();
        let root = storage.artifact_path(&digest());
        fs::create_dir_all(root.join("assets")).await.unwrap();
        fs::write(root.join("assets/app.js"), b"ready")
            .await
            .unwrap();

        let mut file = storage
            .open_artifact_file(&digest(), "assets/app.js")
            .await
            .unwrap();
        let mut contents = String::new();
        file.read_to_string(&mut contents).await.unwrap();
        assert_eq!(contents, "ready");
        assert!(matches!(
            storage.open_artifact_file(&digest(), "../secret").await,
            Err(StorageError::InvalidArtifactPath)
        ));
        assert!(matches!(
            storage.open_artifact_file(&digest(), "assets").await,
            Err(StorageError::InvalidArtifactFile)
        ));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn refuses_symlinks_inside_artifact_directories() {
        use std::os::unix::fs::symlink;

        let temp = tempdir().unwrap();
        let storage = LocalArtifactStore::new(temp.path());
        storage.ensure_layout().await.unwrap();
        let root = storage.artifact_path(&digest());
        fs::create_dir_all(&root).await.unwrap();
        let outside = temp.path().join("secret.txt");
        fs::write(&outside, b"secret").await.unwrap();
        symlink(&outside, root.join("index.html")).unwrap();

        assert!(matches!(
            storage.open_artifact_file(&digest(), "index.html").await,
            Err(StorageError::InvalidArtifactFile)
        ));
    }
}
