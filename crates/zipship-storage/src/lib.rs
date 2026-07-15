#![forbid(unsafe_code)]

use std::path::{Path, PathBuf};
use thiserror::Error;
use tokio::fs;
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

    pub fn artifact_path(&self, digest: &ArtifactDigest) -> PathBuf {
        let digest = digest.as_str();
        self.blob_root()
            .join(&digest[0..2])
            .join(&digest[2..4])
            .join(digest)
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
        if fs::try_exists(&destination).await? {
            fs::remove_dir_all(staging_directory).await?;
            return Ok(CommitOutcome::AlreadyExists);
        }

        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent).await?;
        }
        fs::rename(staging_directory, destination).await?;
        Ok(CommitOutcome::Created)
    }
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
}
