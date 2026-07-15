use std::error::Error as StdError;

use async_trait::async_trait;
use serde_json::Value;
use thiserror::Error;
use time::OffsetDateTime;
use uuid::Uuid;
use zipship_domain::ArtifactDigest;
use zipship_jobs::WorkerId;

use crate::ArtifactManifest;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ArtifactJobContext {
    pub job_id: Uuid,
    pub upload_id: Uuid,
    pub project_id: Uuid,
    pub release_id: Uuid,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReadyArtifact {
    pub digest: ArtifactDigest,
    pub storage_key: String,
    pub manifest: ArtifactManifest,
    pub file_count: u32,
    pub total_size: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ArtifactJobCompletion {
    pub artifact_id: Uuid,
    pub reused_artifact: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ArtifactFailureOutcome {
    RetryScheduled,
    Terminal,
}

#[derive(Debug, Error)]
pub enum ArtifactJobsRepositoryError {
    #[error("artifact job lease is no longer owned by this worker")]
    LeaseLost,
    #[error("artifact job does not reference a valid processing upload and release")]
    InvalidContext,
    #[error("an existing artifact disagrees with the same content digest")]
    ArtifactConflict,
    #[error("artifact jobs repository is unavailable")]
    Unavailable {
        #[source]
        source: Box<dyn StdError + Send + Sync>,
    },
}

impl ArtifactJobsRepositoryError {
    pub fn unavailable(source: impl StdError + Send + Sync + 'static) -> Self {
        Self::Unavailable {
            source: Box::new(source),
        }
    }
}

#[async_trait]
pub trait ArtifactJobsRepository: Send + Sync + 'static {
    async fn load_context(
        &self,
        job_id: Uuid,
        worker_id: &WorkerId,
    ) -> Result<ArtifactJobContext, ArtifactJobsRepositoryError>;

    async fn complete_artifact_job(
        &self,
        context: &ArtifactJobContext,
        worker_id: &WorkerId,
        artifact: &ReadyArtifact,
    ) -> Result<ArtifactJobCompletion, ArtifactJobsRepositoryError>;

    async fn fail_artifact_job(
        &self,
        job_id: Uuid,
        worker_id: &WorkerId,
        error_code: &str,
        error_detail: &Value,
        retry_at: Option<OffsetDateTime>,
    ) -> Result<ArtifactFailureOutcome, ArtifactJobsRepositoryError>;
}
