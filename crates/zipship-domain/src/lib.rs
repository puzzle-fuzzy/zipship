#![forbid(unsafe_code)]

use serde::{Deserialize, Serialize};
use std::{fmt, str::FromStr};
use thiserror::Error;

const RESERVED_SLUGS: &[&str] = &[
    "_api",
    "_console",
    "_health",
    "_assets",
    "favicon.ico",
    "robots.txt",
];

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

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct UploadFilename(String);

impl UploadFilename {
    pub fn parse(value: impl AsRef<str>) -> Result<Self, DomainError> {
        let value = value.as_ref().trim();
        let valid = !value.is_empty()
            && value.len() <= 255
            && !matches!(value, "." | "..")
            && !value.contains(['/', '\\'])
            && !value.chars().any(char::is_control)
            && value.to_ascii_lowercase().ends_with(".zip");
        valid
            .then(|| Self(value.to_owned()))
            .ok_or(DomainError::InvalidUploadFilename)
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(transparent)]
pub struct UploadSize(u64);

impl UploadSize {
    pub fn parse(value: u64, maximum: u64) -> Result<Self, DomainError> {
        (value > 0 && value <= maximum)
            .then_some(Self(value))
            .ok_or(DomainError::InvalidUploadSize)
    }

    pub const fn bytes(self) -> u64 {
        self.0
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct OrganizationName(String);

impl OrganizationName {
    pub fn parse(value: impl AsRef<str>) -> Result<Self, DomainError> {
        normalize_bounded_name(value.as_ref(), 160)
            .map(Self)
            .ok_or(DomainError::InvalidOrganizationName)
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct OrganizationSlug(String);

impl OrganizationSlug {
    pub fn parse(value: impl AsRef<str>) -> Result<Self, DomainError> {
        parse_slug(value.as_ref(), false)
            .map(Self)
            .ok_or(DomainError::InvalidOrganizationSlug)
    }

    pub fn parse_normalized(value: impl AsRef<str>) -> Result<Self, DomainError> {
        Self::parse(value.as_ref().trim().to_ascii_lowercase())
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct ProjectName(String);

impl ProjectName {
    pub fn parse(value: impl AsRef<str>) -> Result<Self, DomainError> {
        normalize_bounded_name(value.as_ref(), 160)
            .map(Self)
            .ok_or(DomainError::InvalidProjectName)
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct ProjectDescription(Option<String>);

impl ProjectDescription {
    pub fn parse(value: Option<&str>) -> Result<Self, DomainError> {
        let Some(value) = value else {
            return Ok(Self(None));
        };
        let normalized = value.trim();
        if normalized.is_empty() {
            return Ok(Self(None));
        }
        if normalized.chars().count() > 2_000 || normalized.contains('\0') {
            return Err(DomainError::InvalidProjectDescription);
        }
        Ok(Self(Some(normalized.to_owned())))
    }

    pub fn as_deref(&self) -> Option<&str> {
        self.0.as_deref()
    }

    pub fn into_inner(self) -> Option<String> {
        self.0
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct ProjectSlug(String);

impl ProjectSlug {
    pub fn parse(value: impl AsRef<str>) -> Result<Self, DomainError> {
        parse_slug(value.as_ref(), true)
            .map(Self)
            .ok_or(DomainError::InvalidProjectSlug)
    }

    pub fn parse_normalized(value: impl AsRef<str>) -> Result<Self, DomainError> {
        Self::parse(value.as_ref().trim().to_ascii_lowercase())
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

fn parse_slug(value: &str, check_reserved: bool) -> Option<String> {
    let valid_length = !value.is_empty() && value.len() <= 63;
    let valid_start = value.as_bytes().first().is_some_and(u8::is_ascii_lowercase)
        || value.as_bytes().first().is_some_and(u8::is_ascii_digit);
    let valid_chars = value.bytes().all(|byte| {
        byte.is_ascii_lowercase() || byte.is_ascii_digit() || matches!(byte, b'-' | b'_')
    });
    let reserved = check_reserved && RESERVED_SLUGS.contains(&value);
    (valid_length && valid_start && valid_chars && !reserved).then(|| value.to_owned())
}

fn normalize_bounded_name(value: &str, max_characters: usize) -> Option<String> {
    let normalized = value.trim();
    let character_count = normalized.chars().count();
    (character_count > 0
        && character_count <= max_characters
        && !normalized.chars().any(char::is_control))
    .then(|| normalized.to_owned())
}

impl fmt::Display for ProjectSlug {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl FromStr for ProjectSlug {
    type Err = DomainError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        Self::parse(value)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct ArtifactDigest(String);

impl ArtifactDigest {
    pub fn parse(value: impl AsRef<str>) -> Result<Self, DomainError> {
        let value = value.as_ref();
        let valid = value.len() == 64
            && value
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte));

        valid
            .then(|| Self(value.to_owned()))
            .ok_or(DomainError::InvalidArtifactDigest)
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for ArtifactDigest {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl FromStr for ArtifactDigest {
    type Err = DomainError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        Self::parse(value)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum JobStatus {
    Queued,
    Running,
    Succeeded,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum JobKind {
    #[serde(rename = "artifact.process")]
    ArtifactProcess,
    #[serde(rename = "runtime.check")]
    RuntimeCheck,
    #[serde(rename = "webhook.deliver")]
    WebhookDeliver,
    #[serde(rename = "artifact.gc")]
    ArtifactGc,
}

impl JobKind {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::ArtifactProcess => "artifact.process",
            Self::RuntimeCheck => "runtime.check",
            Self::WebhookDeliver => "webhook.deliver",
            Self::ArtifactGc => "artifact.gc",
        }
    }
}

impl FromStr for JobKind {
    type Err = DomainError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "artifact.process" => Ok(Self::ArtifactProcess),
            "runtime.check" => Ok(Self::RuntimeCheck),
            "webhook.deliver" => Ok(Self::WebhookDeliver),
            "artifact.gc" => Ok(Self::ArtifactGc),
            _ => Err(DomainError::InvalidJobKind),
        }
    }
}

impl JobStatus {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Queued => "queued",
            Self::Running => "running",
            Self::Succeeded => "succeeded",
            Self::Failed => "failed",
            Self::Cancelled => "cancelled",
        }
    }

    pub fn transition_to(self, next: Self) -> Result<Self, DomainError> {
        let allowed = matches!(
            (self, next),
            (Self::Queued, Self::Running | Self::Cancelled)
                | (
                    Self::Running,
                    Self::Queued | Self::Succeeded | Self::Failed | Self::Cancelled
                )
                | (Self::Failed, Self::Queued)
        );

        allowed
            .then_some(next)
            .ok_or(DomainError::InvalidStateTransition {
                from: self.as_str(),
                to: next.as_str(),
            })
    }
}

impl FromStr for JobStatus {
    type Err = DomainError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "queued" => Ok(Self::Queued),
            "running" => Ok(Self::Running),
            "succeeded" => Ok(Self::Succeeded),
            "failed" => Ok(Self::Failed),
            "cancelled" => Ok(Self::Cancelled),
            _ => Err(DomainError::InvalidJobStatus),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReleaseStatus {
    Processing,
    Ready,
    Failed,
    Archived,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum UploadStatus {
    Pending,
    Receiving,
    Uploaded,
    Processing,
    Completed,
    Failed,
    Cancelled,
}

impl UploadStatus {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Receiving => "receiving",
            Self::Uploaded => "uploaded",
            Self::Processing => "processing",
            Self::Completed => "completed",
            Self::Failed => "failed",
            Self::Cancelled => "cancelled",
        }
    }

    pub fn transition_to(self, next: Self) -> Result<Self, DomainError> {
        let allowed = matches!(
            (self, next),
            (Self::Pending, Self::Receiving | Self::Cancelled)
                | (
                    Self::Receiving,
                    Self::Pending | Self::Uploaded | Self::Failed | Self::Cancelled
                )
                | (Self::Uploaded, Self::Processing | Self::Cancelled)
                | (Self::Processing, Self::Completed | Self::Failed)
        );
        allowed
            .then_some(next)
            .ok_or(DomainError::InvalidStateTransition {
                from: self.as_str(),
                to: next.as_str(),
            })
    }
}

impl FromStr for UploadStatus {
    type Err = DomainError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "pending" => Ok(Self::Pending),
            "receiving" => Ok(Self::Receiving),
            "uploaded" => Ok(Self::Uploaded),
            "processing" => Ok(Self::Processing),
            "completed" => Ok(Self::Completed),
            "failed" => Ok(Self::Failed),
            "cancelled" => Ok(Self::Cancelled),
            _ => Err(DomainError::InvalidUploadStatus),
        }
    }
}

impl ReleaseStatus {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Processing => "processing",
            Self::Ready => "ready",
            Self::Failed => "failed",
            Self::Archived => "archived",
        }
    }

    pub fn transition_to(self, next: Self) -> Result<Self, DomainError> {
        let allowed = matches!(
            (self, next),
            (Self::Processing, Self::Ready | Self::Failed)
                | (Self::Ready, Self::Archived)
                | (Self::Failed, Self::Processing | Self::Archived)
        );

        allowed
            .then_some(next)
            .ok_or(DomainError::InvalidStateTransition {
                from: self.as_str(),
                to: next.as_str(),
            })
    }
}

impl FromStr for ReleaseStatus {
    type Err = DomainError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "processing" => Ok(Self::Processing),
            "ready" => Ok(Self::Ready),
            "failed" => Ok(Self::Failed),
            "archived" => Ok(Self::Archived),
            _ => Err(DomainError::InvalidReleaseStatus),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MemberRole {
    Owner,
    Admin,
    Developer,
    Deployer,
    Viewer,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PermissionAction {
    ViewOrganization,
    InviteMember,
    ManageMember,
    ViewProject,
    CreateProject,
    ManageProject,
    UploadRelease,
    PublishRelease,
    RollbackRelease,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CachePolicy {
    Standard,
    Aggressive,
}

impl CachePolicy {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Standard => "standard",
            Self::Aggressive => "aggressive",
        }
    }
}

impl FromStr for CachePolicy {
    type Err = DomainError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "standard" => Ok(Self::Standard),
            "aggressive" => Ok(Self::Aggressive),
            _ => Err(DomainError::InvalidCachePolicy),
        }
    }
}

impl MemberRole {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Owner => "owner",
            Self::Admin => "admin",
            Self::Developer => "developer",
            Self::Deployer => "deployer",
            Self::Viewer => "viewer",
        }
    }

    pub const fn can(self, action: PermissionAction) -> bool {
        match self {
            Self::Owner | Self::Admin => true,
            Self::Developer => matches!(
                action,
                PermissionAction::ViewOrganization
                    | PermissionAction::ViewProject
                    | PermissionAction::CreateProject
                    | PermissionAction::UploadRelease
            ),
            Self::Deployer => matches!(
                action,
                PermissionAction::ViewOrganization
                    | PermissionAction::ViewProject
                    | PermissionAction::PublishRelease
                    | PermissionAction::RollbackRelease
            ),
            Self::Viewer => matches!(
                action,
                PermissionAction::ViewOrganization | PermissionAction::ViewProject
            ),
        }
    }
}

impl FromStr for MemberRole {
    type Err = DomainError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "owner" => Ok(Self::Owner),
            "admin" => Ok(Self::Admin),
            "developer" => Ok(Self::Developer),
            "deployer" => Ok(Self::Deployer),
            "viewer" => Ok(Self::Viewer),
            _ => Err(DomainError::InvalidMemberRole),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_project_slugs() {
        assert_eq!(
            ProjectSlug::parse("marketing_site").unwrap().as_str(),
            "marketing_site"
        );
        assert!(ProjectSlug::parse("_api").is_err());
        assert!(ProjectSlug::parse("Uppercase").is_err());
        assert!(ProjectSlug::parse("-leading").is_err());
        assert!(ProjectSlug::parse("a".repeat(64)).is_err());
        assert_eq!(
            ProjectSlug::parse_normalized(" Marketing-Site ")
                .unwrap()
                .as_str(),
            "marketing-site",
        );
    }

    #[test]
    fn normalizes_organization_and_project_metadata() {
        assert_eq!(
            OrganizationName::parse("  Puzzle Fuzzy  ")
                .unwrap()
                .as_str(),
            "Puzzle Fuzzy",
        );
        assert_eq!(
            OrganizationSlug::parse_normalized(" Puzzle-Fuzzy ")
                .unwrap()
                .as_str(),
            "puzzle-fuzzy",
        );
        assert_eq!(
            ProjectName::parse("  Marketing Site  ").unwrap().as_str(),
            "Marketing Site",
        );
        assert_eq!(
            ProjectDescription::parse(Some("  Static campaign site  "))
                .unwrap()
                .as_deref(),
            Some("Static campaign site"),
        );
        assert_eq!(
            ProjectDescription::parse(Some("  ")).unwrap().as_deref(),
            None,
        );
    }

    #[test]
    fn requires_a_full_lowercase_sha256_digest() {
        let digest = "0123456789abcdef".repeat(4);
        assert_eq!(ArtifactDigest::parse(&digest).unwrap().as_str(), digest);
        assert!(ArtifactDigest::parse("0123456789ab").is_err());
        assert!(ArtifactDigest::parse("A".repeat(64)).is_err());
    }

    #[test]
    fn enforces_job_state_transitions() {
        assert_eq!(
            JobKind::from_str("artifact.process"),
            Ok(JobKind::ArtifactProcess),
        );
        assert_eq!(JobStatus::from_str("running"), Ok(JobStatus::Running));
        assert_eq!(
            JobKind::from_str("unknown"),
            Err(DomainError::InvalidJobKind),
        );
        assert_eq!(
            JobStatus::from_str("unknown"),
            Err(DomainError::InvalidJobStatus),
        );
        assert_eq!(
            JobStatus::Queued.transition_to(JobStatus::Running),
            Ok(JobStatus::Running)
        );
        assert_eq!(
            JobStatus::Running.transition_to(JobStatus::Queued),
            Ok(JobStatus::Queued)
        );
        assert!(
            JobStatus::Succeeded
                .transition_to(JobStatus::Running)
                .is_err()
        );
    }

    #[test]
    fn release_activity_is_not_a_release_state() {
        assert_eq!("ready".parse(), Ok(ReleaseStatus::Ready));
        assert_eq!(
            "active".parse::<ReleaseStatus>(),
            Err(DomainError::InvalidReleaseStatus)
        );
        assert_eq!(
            ReleaseStatus::Processing.transition_to(ReleaseStatus::Ready),
            Ok(ReleaseStatus::Ready),
        );
        assert!(
            ReleaseStatus::Ready
                .transition_to(ReleaseStatus::Processing)
                .is_err()
        );
    }

    #[test]
    fn validates_upload_metadata_and_state_transitions() {
        assert_eq!(
            UploadFilename::parse("  frontend.ZIP  ").unwrap().as_str(),
            "frontend.ZIP",
        );
        assert!(UploadFilename::parse("../frontend.zip").is_err());
        assert!(UploadFilename::parse("frontend.tar.gz").is_err());
        assert_eq!(UploadSize::parse(512, 1_024).unwrap().bytes(), 512);
        assert!(UploadSize::parse(0, 1_024).is_err());
        assert!(UploadSize::parse(1_025, 1_024).is_err());
        assert_eq!(
            UploadStatus::Pending.transition_to(UploadStatus::Receiving),
            Ok(UploadStatus::Receiving),
        );
        assert_eq!(
            UploadStatus::Uploaded.transition_to(UploadStatus::Processing),
            Ok(UploadStatus::Processing),
        );
        assert_eq!(
            UploadStatus::Receiving.transition_to(UploadStatus::Pending),
            Ok(UploadStatus::Pending),
        );
        assert!(
            UploadStatus::Pending
                .transition_to(UploadStatus::Completed)
                .is_err()
        );
        assert!(
            UploadStatus::Completed
                .transition_to(UploadStatus::Receiving)
                .is_err()
        );
        assert_eq!("uploaded".parse(), Ok(UploadStatus::Uploaded));
        assert!("unknown".parse::<UploadStatus>().is_err());
    }

    #[test]
    fn role_capabilities_match_the_product_policy() {
        assert!(MemberRole::Admin.can(PermissionAction::ManageMember));
        assert!(MemberRole::Developer.can(PermissionAction::UploadRelease));
        assert!(!MemberRole::Developer.can(PermissionAction::PublishRelease));
        assert!(MemberRole::Deployer.can(PermissionAction::PublishRelease));
        assert!(!MemberRole::Viewer.can(PermissionAction::UploadRelease));
        assert!(MemberRole::Admin.can(PermissionAction::ManageProject));
        assert!(MemberRole::Developer.can(PermissionAction::CreateProject));
        assert!(!MemberRole::Developer.can(PermissionAction::ManageProject));
        assert!(MemberRole::Deployer.can(PermissionAction::RollbackRelease));
        assert!(!MemberRole::Viewer.can(PermissionAction::CreateProject));
        assert_eq!("deployer".parse(), Ok(MemberRole::Deployer));
    }
}
