use crate::{constants::MAX_IDEMPOTENCY_KEY_BYTES, error::DeploymentsError};
use std::str::FromStr;
use time::OffsetDateTime;
use uuid::Uuid;

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
