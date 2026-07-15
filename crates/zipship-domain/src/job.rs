use std::str::FromStr;

use serde::{Deserialize, Serialize};

use crate::DomainError;

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
