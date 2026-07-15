use thiserror::Error;

#[derive(Debug, Error, Clone, Copy, PartialEq, Eq)]
pub enum DeploymentsError {
    #[error("deployment input is invalid")]
    InvalidInput,
    #[error("deployment is forbidden")]
    Forbidden,
    #[error("project was not found")]
    ProjectNotFound,
    #[error("release was not found")]
    ReleaseNotFound,
    #[error("release is not ready")]
    ReleaseNotReady,
    #[error("release is already active")]
    ReleaseAlreadyActive,
    #[error("release cannot be used as a rollback target")]
    ReleaseNotRollbackable,
    #[error("idempotency key was reused")]
    IdempotencyConflict,
    #[error("deployments infrastructure failed")]
    Infrastructure,
}

impl DeploymentsError {
    pub const fn code(self) -> &'static str {
        match self {
            Self::InvalidInput => "INVALID_DEPLOYMENT_INPUT",
            Self::Forbidden => "FORBIDDEN",
            Self::ProjectNotFound => "PROJECT_NOT_FOUND",
            Self::ReleaseNotFound => "RELEASE_NOT_FOUND",
            Self::ReleaseNotReady => "RELEASE_NOT_READY",
            Self::ReleaseAlreadyActive => "RELEASE_ALREADY_ACTIVE",
            Self::ReleaseNotRollbackable => "RELEASE_NOT_ROLLBACKABLE",
            Self::IdempotencyConflict => "IDEMPOTENCY_KEY_REUSED",
            Self::Infrastructure => "DEPLOYMENTS_INFRASTRUCTURE_FAILURE",
        }
    }
}
