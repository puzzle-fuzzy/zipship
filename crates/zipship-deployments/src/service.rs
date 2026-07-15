use crate::{
    constants::MAX_MESSAGE_CHARACTERS,
    error::DeploymentsError,
    model::{
        Deployment, DeploymentAction, DeploymentRequest, DeploymentResult, IdempotencyKey,
        NewDeployment,
    },
    repository::{Clock, DeploymentsRepository, DeploymentsRepositoryError, SystemClock},
};
use std::sync::Arc;
use uuid::Uuid;

#[derive(Clone)]
pub struct DeploymentsService {
    repository: Arc<dyn DeploymentsRepository>,
    clock: Arc<dyn Clock>,
}

impl DeploymentsService {
    pub fn new(repository: Arc<dyn DeploymentsRepository>) -> Self {
        Self::with_clock(repository, Arc::new(SystemClock))
    }

    pub fn with_clock(repository: Arc<dyn DeploymentsRepository>, clock: Arc<dyn Clock>) -> Self {
        Self { repository, clock }
    }

    pub async fn publish(
        &self,
        request: DeploymentRequest,
    ) -> Result<DeploymentResult, DeploymentsError> {
        self.execute(DeploymentAction::Publish, request).await
    }

    pub async fn rollback(
        &self,
        request: DeploymentRequest,
    ) -> Result<DeploymentResult, DeploymentsError> {
        self.execute(DeploymentAction::Rollback, request).await
    }

    pub async fn list(
        &self,
        actor_id: Uuid,
        project_id: Uuid,
    ) -> Result<Vec<Deployment>, DeploymentsError> {
        self.repository
            .list_for_project(project_id, actor_id)
            .await
            .map_err(map_repository_error)
    }

    async fn execute(
        &self,
        action: DeploymentAction,
        request: DeploymentRequest,
    ) -> Result<DeploymentResult, DeploymentsError> {
        let idempotency_key = IdempotencyKey::parse(request.idempotency_key)?;
        let message = normalize_message(request.message)?;
        self.repository
            .execute(NewDeployment {
                id: Uuid::new_v4(),
                project_id: request.project_id,
                release_id: request.release_id,
                actor_id: request.actor_id,
                action,
                idempotency_key,
                message,
                request_id: request.request_id,
                now: self.clock.now(),
            })
            .await
            .map_err(map_repository_error)
    }
}

fn normalize_message(message: Option<String>) -> Result<Option<String>, DeploymentsError> {
    let Some(message) = message else {
        return Ok(None);
    };
    let message = message.trim();
    if message.is_empty() {
        return Ok(None);
    }
    if message.chars().count() > MAX_MESSAGE_CHARACTERS || message.chars().any(char::is_control) {
        return Err(DeploymentsError::InvalidInput);
    }
    Ok(Some(message.to_owned()))
}

fn map_repository_error(error: DeploymentsRepositoryError) -> DeploymentsError {
    match error {
        DeploymentsRepositoryError::Forbidden => DeploymentsError::Forbidden,
        DeploymentsRepositoryError::ProjectNotFound => DeploymentsError::ProjectNotFound,
        DeploymentsRepositoryError::ReleaseNotFound => DeploymentsError::ReleaseNotFound,
        DeploymentsRepositoryError::ReleaseNotReady => DeploymentsError::ReleaseNotReady,
        DeploymentsRepositoryError::ReleaseAlreadyActive => DeploymentsError::ReleaseAlreadyActive,
        DeploymentsRepositoryError::ReleaseNotRollbackable => {
            DeploymentsError::ReleaseNotRollbackable
        }
        DeploymentsRepositoryError::IdempotencyConflict => DeploymentsError::IdempotencyConflict,
        DeploymentsRepositoryError::Unavailable { .. } => DeploymentsError::Infrastructure,
    }
}
