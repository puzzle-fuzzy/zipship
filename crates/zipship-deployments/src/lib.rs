#![forbid(unsafe_code)]

use async_trait::async_trait;
use std::{error::Error as StdError, str::FromStr, sync::Arc};
use thiserror::Error;
use time::OffsetDateTime;
use uuid::Uuid;

const MAX_IDEMPOTENCY_KEY_BYTES: usize = 128;
const MAX_MESSAGE_CHARACTERS: usize = 500;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DeploymentAction {
    Publish,
    Rollback,
}

impl DeploymentAction {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Publish => "publish",
            Self::Rollback => "rollback",
        }
    }

    pub const fn audit_action(self) -> &'static str {
        match self {
            Self::Publish => "release.published",
            Self::Rollback => "release.rolled_back",
        }
    }
}

impl FromStr for DeploymentAction {
    type Err = DeploymentsError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "publish" => Ok(Self::Publish),
            "rollback" => Ok(Self::Rollback),
            _ => Err(DeploymentsError::Infrastructure),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DeploymentStatus {
    Succeeded,
    Failed,
}

impl DeploymentStatus {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Succeeded => "succeeded",
            Self::Failed => "failed",
        }
    }
}

impl FromStr for DeploymentStatus {
    type Err = DeploymentsError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "succeeded" => Ok(Self::Succeeded),
            "failed" => Ok(Self::Failed),
            _ => Err(DeploymentsError::Infrastructure),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Deployment {
    pub id: Uuid,
    pub project_id: Uuid,
    pub release_id: Uuid,
    pub previous_release_id: Option<Uuid>,
    pub action: DeploymentAction,
    pub status: DeploymentStatus,
    pub actor_id: Uuid,
    pub message: Option<String>,
    pub created_at: OffsetDateTime,
    pub finished_at: OffsetDateTime,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DeploymentResult {
    pub deployment: Deployment,
    pub active_release_id: Uuid,
    pub replayed: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DeploymentRequest {
    pub project_id: Uuid,
    pub release_id: Uuid,
    pub actor_id: Uuid,
    pub idempotency_key: String,
    pub message: Option<String>,
    pub request_id: Option<Uuid>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewDeployment {
    pub id: Uuid,
    pub project_id: Uuid,
    pub release_id: Uuid,
    pub actor_id: Uuid,
    pub action: DeploymentAction,
    pub idempotency_key: IdempotencyKey,
    pub message: Option<String>,
    pub request_id: Option<Uuid>,
    pub now: OffsetDateTime,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IdempotencyKey(String);

impl IdempotencyKey {
    pub fn parse(value: impl Into<String>) -> Result<Self, DeploymentsError> {
        let value = value.into();
        let valid = !value.is_empty()
            && value.len() <= MAX_IDEMPOTENCY_KEY_BYTES
            && value.bytes().all(|byte| (b'!'..=b'~').contains(&byte));
        valid
            .then_some(Self(value))
            .ok_or(DeploymentsError::InvalidInput)
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

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

#[derive(Debug, Error, Clone, Copy, PartialEq, Eq)]
pub enum DeploymentsError {
    #[error("deployment input is invalid")]
    InvalidInput,
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
    #[error("release cannot be used as a rollback target")]
    ReleaseNotRollbackable,
    #[error("idempotency key was reused")]
    IdempotencyConflict,
    #[error("deployments infrastructure failed")]
    Infrastructure,
}

impl DeploymentsError {
    pub const fn code(self) -> &'static str {
        match self {
            Self::InvalidInput => "INVALID_DEPLOYMENT_INPUT",
            Self::Forbidden => "FORBIDDEN",
            Self::ProjectNotFound => "PROJECT_NOT_FOUND",
            Self::ReleaseNotFound => "RELEASE_NOT_FOUND",
            Self::ReleaseNotReady => "RELEASE_NOT_READY",
            Self::ReleaseAlreadyActive => "RELEASE_ALREADY_ACTIVE",
            Self::ReleaseNotRollbackable => "RELEASE_NOT_ROLLBACKABLE",
            Self::IdempotencyConflict => "IDEMPOTENCY_KEY_REUSED",
            Self::Infrastructure => "DEPLOYMENTS_INFRASTRUCTURE_FAILURE",
        }
    }
}

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

#[cfg(test)]
mod tests;
