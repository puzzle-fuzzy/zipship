use thiserror::Error;

#[derive(Debug, Error, Clone, PartialEq, Eq)]
pub enum DomainError {
    #[error("invalid organization name")]
    InvalidOrganizationName,
    #[error("invalid organization slug")]
    InvalidOrganizationSlug,
    #[error("invalid project name")]
    InvalidProjectName,
    #[error("invalid project slug")]
    InvalidProjectSlug,
    #[error("invalid project description")]
    InvalidProjectDescription,
    #[error("invalid member role")]
    InvalidMemberRole,
    #[error("invalid cache policy")]
    InvalidCachePolicy,
    #[error("invalid upload filename")]
    InvalidUploadFilename,
    #[error("invalid upload size")]
    InvalidUploadSize,
    #[error("invalid upload status")]
    InvalidUploadStatus,
    #[error("invalid job kind")]
    InvalidJobKind,
    #[error("invalid job status")]
    InvalidJobStatus,
    #[error("invalid release status")]
    InvalidReleaseStatus,
    #[error("invalid SHA-256 artifact digest")]
    InvalidArtifactDigest,
    #[error("invalid state transition from {from} to {to}")]
    InvalidStateTransition {
        from: &'static str,
        to: &'static str,
    },
}
