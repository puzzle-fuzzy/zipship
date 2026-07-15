use crate::{
    model::{CommitOutcome, StorageError, UploadWriteResult},
    path::{regular_path_components, sync_directory_if_supported},
};
use std::path::{Path, PathBuf};
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
