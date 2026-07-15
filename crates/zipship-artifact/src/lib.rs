#![forbid(unsafe_code)]

mod archive;
mod central_directory;
mod error;
mod jobs;
mod manifest;
mod model;

pub use archive::extract_artifact;
pub use error::ArtifactError;
pub use jobs::{
    ArtifactFailureOutcome, ArtifactJobCompletion, ArtifactJobContext, ArtifactJobsRepository,
    ArtifactJobsRepositoryError, ReadyArtifact,
};
pub use model::{ArtifactLimits, ArtifactManifest, ExtractedArtifact, ManifestEntry};

#[cfg(test)]
mod tests;
