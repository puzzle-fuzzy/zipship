use serde_json::Value;
use sqlx::FromRow;
use uuid::Uuid;
use zipship_artifact::{ArtifactJobContext, ArtifactJobsRepositoryError};

#[derive(Debug, FromRow)]
pub(super) struct ContextRow {
    pub(super) upload_id: Uuid,
    pub(super) project_id: Uuid,
    pub(super) release_id: Option<Uuid>,
    pub(super) staging_key: String,
}

impl ContextRow {
    pub(super) fn try_into_context(
        self,
        job_id: Uuid,
    ) -> Result<ArtifactJobContext, ArtifactJobsRepositoryError> {
        if self.staging_key != format!("uploads/{}/archive.zip", self.upload_id) {
            return Err(ArtifactJobsRepositoryError::InvalidContext);
        }
        Ok(ArtifactJobContext {
            job_id,
            upload_id: self.upload_id,
            project_id: self.project_id,
            release_id: self
                .release_id
                .ok_or(ArtifactJobsRepositoryError::InvalidContext)?,
        })
    }
}

#[derive(Debug, FromRow)]
pub(super) struct ExistingArtifactRow {
    pub(super) id: Uuid,
    pub(super) storage_key: String,
    pub(super) state: String,
    pub(super) file_count: i32,
    pub(super) total_size: i64,
    pub(super) manifest: Value,
    pub(super) detect_report: Value,
}

#[derive(Debug, FromRow)]
pub(super) struct FailureJobRow {
    pub(super) domain_id: Option<Uuid>,
    pub(super) attempts: i32,
    pub(super) max_attempts: i32,
}

#[derive(Debug, FromRow)]
pub(super) struct FailureContextRow {
    pub(super) release_id: Uuid,
    pub(super) project_id: Uuid,
    pub(super) organization_id: Uuid,
    pub(super) created_by: Uuid,
}
