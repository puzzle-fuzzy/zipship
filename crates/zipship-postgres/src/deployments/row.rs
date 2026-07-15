use sqlx::FromRow;
use std::{fmt, str::FromStr};
use time::OffsetDateTime;
use uuid::Uuid;
use zipship_deployments::{
    Deployment, DeploymentAction, DeploymentStatus, DeploymentsRepositoryError,
};

pub(super) fn corrupt_record() -> DeploymentsRepositoryError {
    DeploymentsRepositoryError::unavailable(CorruptDeploymentRecord)
}

#[derive(Debug)]
struct CorruptDeploymentRecord;

impl fmt::Display for CorruptDeploymentRecord {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("database returned an invalid deployment record")
    }
}

impl std::error::Error for CorruptDeploymentRecord {}

#[derive(Debug, FromRow)]
pub(super) struct ProjectRow {
    #[allow(dead_code)]
    id: Uuid,
    pub(super) organization_id: Uuid,
}

#[derive(Debug, FromRow)]
pub(super) struct ProjectAccessRow {
    #[allow(dead_code)]
    id: Uuid,
    pub(super) role: String,
}

#[derive(Debug, FromRow)]
pub(super) struct ReleaseReadinessRow {
    pub(super) release_state: String,
    pub(super) artifact_id: Option<Uuid>,
}

#[derive(Debug, FromRow)]
pub(super) struct DeploymentRow {
    pub(super) id: Uuid,
    pub(super) project_id: Uuid,
    pub(super) release_id: Uuid,
    pub(super) previous_release_id: Option<Uuid>,
    pub(super) action: String,
    pub(super) status: String,
    pub(super) actor_id: Uuid,
    pub(super) message: Option<String>,
    pub(super) created_at: OffsetDateTime,
    pub(super) finished_at: OffsetDateTime,
}

impl DeploymentRow {
    pub(super) fn try_into_deployment(self) -> Result<Deployment, DeploymentsRepositoryError> {
        Ok(Deployment {
            id: self.id,
            project_id: self.project_id,
            release_id: self.release_id,
            previous_release_id: self.previous_release_id,
            action: DeploymentAction::from_str(&self.action).map_err(|_| corrupt_record())?,
            status: DeploymentStatus::from_str(&self.status).map_err(|_| corrupt_record())?,
            actor_id: self.actor_id,
            message: self.message,
            created_at: self.created_at,
            finished_at: self.finished_at,
        })
    }
}
