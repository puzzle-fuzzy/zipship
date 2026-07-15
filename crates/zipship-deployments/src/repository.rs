use crate::model::{Deployment, DeploymentResult, NewDeployment};
use async_trait::async_trait;
use std::error::Error as StdError;
use thiserror::Error;
use time::OffsetDateTime;
use uuid::Uuid;

#[derive(Debug, Error)]
pub enum DeploymentsRepositoryError {
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
    #[error("release has never been active and cannot be rolled back to")]
    ReleaseNotRollbackable,
    #[error("idempotency key was reused for a different request")]
    IdempotencyConflict,
    #[error("deployments repository is unavailable")]
    Unavailable {
        #[source]
        source: Box<dyn StdError + Send + Sync>,
    },
}

impl DeploymentsRepositoryError {
    pub fn unavailable(source: impl StdError + Send + Sync + 'static) -> Self {
        Self::Unavailable {
            source: Box::new(source),
        }
    }
}

#[async_trait]
pub trait DeploymentsRepository: Send + Sync + 'static {
    async fn execute(
        &self,
        deployment: NewDeployment,
    ) -> Result<DeploymentResult, DeploymentsRepositoryError>;

    async fn list_for_project(
        &self,
        project_id: Uuid,
        actor_id: Uuid,
    ) -> Result<Vec<Deployment>, DeploymentsRepositoryError>;
}

pub trait Clock: Send + Sync + 'static {
    fn now(&self) -> OffsetDateTime;
}

#[derive(Debug, Default)]
pub struct SystemClock;

impl Clock for SystemClock {
    fn now(&self) -> OffsetDateTime {
        OffsetDateTime::now_utc()
    }
}
