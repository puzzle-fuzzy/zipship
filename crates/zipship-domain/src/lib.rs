#![forbid(unsafe_code)]

mod artifact;
mod error;
mod job;
mod normalization;
mod organization;
mod permission;
mod project;
mod release;
mod upload;

pub use artifact::ArtifactDigest;
pub use error::DomainError;
pub use job::{JobKind, JobStatus};
pub use organization::{OrganizationName, OrganizationSlug};
pub use permission::{MemberRole, PermissionAction};
pub use project::{CachePolicy, ProjectDescription, ProjectName, ProjectSlug};
pub use release::ReleaseStatus;
pub use upload::{UploadFilename, UploadSize, UploadStatus};

#[cfg(test)]
mod tests;
