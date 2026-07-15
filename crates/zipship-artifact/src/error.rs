use thiserror::Error;

#[derive(Debug, Error)]
pub enum ArtifactError {
    #[error("artifact filesystem operation failed")]
    Io(#[source] std::io::Error),
    #[error("archive is not a valid ZIP file")]
    InvalidArchive,
    #[error("encrypted ZIP entries are not accepted")]
    EncryptedArchive,
    #[error("ZIP entry path is unsafe or non-portable")]
    UnsafePath,
    #[error("ZIP entry type is not a regular file or directory")]
    UnsupportedEntryType,
    #[error("ZIP compression method is not supported")]
    UnsupportedCompression,
    #[error("ZIP contains too many entries")]
    TooManyEntries,
    #[error("ZIP entry exceeds the per-file size limit")]
    FileTooLarge,
    #[error("ZIP expanded data exceeds the total size limit")]
    ExpandedDataTooLarge,
    #[error("ZIP entry exceeds the compression ratio limit")]
    CompressionRatioExceeded,
    #[error("ZIP contains duplicate or case-colliding paths")]
    DuplicatePath,
    #[error("ZIP contains a file/directory path conflict")]
    PathConflict,
    #[error("ZIP entry exceeds the path depth limit")]
    PathTooDeep,
    #[error("artifact destination already exists")]
    DestinationExists,
    #[error("artifact has no index.html entry point")]
    MissingIndex,
    #[error("artifact has multiple equally plausible index.html roots")]
    AmbiguousIndex,
}

impl ArtifactError {
    pub const fn code(&self) -> &'static str {
        match self {
            Self::Io(_) => "ARTIFACT_IO_FAILURE",
            Self::InvalidArchive => "INVALID_ZIP_ARCHIVE",
            Self::EncryptedArchive => "ENCRYPTED_ZIP_UNSUPPORTED",
            Self::UnsafePath => "UNSAFE_ZIP_PATH",
            Self::UnsupportedEntryType => "UNSUPPORTED_ZIP_ENTRY_TYPE",
            Self::UnsupportedCompression => "UNSUPPORTED_ZIP_COMPRESSION",
            Self::TooManyEntries => "ZIP_ENTRY_LIMIT_EXCEEDED",
            Self::FileTooLarge => "ZIP_FILE_SIZE_LIMIT_EXCEEDED",
            Self::ExpandedDataTooLarge => "ZIP_EXPANDED_SIZE_LIMIT_EXCEEDED",
            Self::CompressionRatioExceeded => "ZIP_COMPRESSION_RATIO_EXCEEDED",
            Self::DuplicatePath => "DUPLICATE_ZIP_PATH",
            Self::PathConflict => "ZIP_PATH_CONFLICT",
            Self::PathTooDeep => "ZIP_PATH_DEPTH_EXCEEDED",
            Self::DestinationExists => "ARTIFACT_DESTINATION_EXISTS",
            Self::MissingIndex => "ARTIFACT_INDEX_MISSING",
            Self::AmbiguousIndex => "ARTIFACT_INDEX_AMBIGUOUS",
        }
    }

    pub const fn retryable(&self) -> bool {
        matches!(self, Self::Io(_))
    }
}
