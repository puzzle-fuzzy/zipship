use std::path::PathBuf;
use thiserror::Error;

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
