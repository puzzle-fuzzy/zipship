#![forbid(unsafe_code)]

mod archive;
mod central_directory;
mod detect;
mod error;
mod jobs;
mod manifest;
mod model;
mod report;

pub use archive::extract_artifact;
pub use detect::detect_artifact;
pub use error::ArtifactError;
pub use jobs::{
    ArtifactFailureOutcome, ArtifactJobCompletion, ArtifactJobContext, ArtifactJobsRepository,
    ArtifactJobsRepositoryError, ReadyArtifact,
};
pub use model::{ArtifactLimits, ArtifactManifest, ExtractedArtifact, ManifestEntry};
pub use report::{
    ArtifactAssetBreakdown, ArtifactAssetSummary, ArtifactAssetTypeSummary, ArtifactDetectReport,
    ArtifactFileSummary, ArtifactHtmlMetadata, ArtifactInsights, ArtifactIssueLevel,
    ArtifactReportIssue, ArtifactReportLevel, ArtifactSeoCheck, ArtifactSeoSummary, SeoCheckStatus,
};

#[cfg(test)]
mod tests;
