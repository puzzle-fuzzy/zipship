use thiserror::Error;

#[derive(Debug, Error, Clone, Copy, PartialEq, Eq)]
pub enum UploadsError {
    #[error("upload input is invalid")]
    InvalidInput,
    #[error("operation is forbidden")]
    Forbidden,
    #[error("upload was not found")]
    NotFound,
    #[error("upload state does not permit this operation")]
    StateConflict,
    #[error("upload has expired")]
    Expired,
    #[error("upload byte count did not match the declaration")]
    SizeMismatch,
    #[error("uploads infrastructure failed")]
    Infrastructure,
}

impl UploadsError {
    pub const fn code(self) -> &'static str {
        match self {
            Self::InvalidInput => "INVALID_UPLOAD_INPUT",
            Self::Forbidden => "FORBIDDEN",
            Self::NotFound => "UPLOAD_NOT_FOUND",
            Self::StateConflict => "UPLOAD_STATE_CONFLICT",
            Self::Expired => "UPLOAD_EXPIRED",
            Self::SizeMismatch => "UPLOAD_SIZE_MISMATCH",
            Self::Infrastructure => "UPLOADS_INFRASTRUCTURE_FAILURE",
        }
    }
}
