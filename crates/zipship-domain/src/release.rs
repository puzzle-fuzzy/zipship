use std::str::FromStr;

use serde::{Deserialize, Serialize};

use crate::DomainError;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReleaseStatus {
    Processing,
    Ready,
    Failed,
    Archived,
}

impl ReleaseStatus {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Processing => "processing",
            Self::Ready => "ready",
            Self::Failed => "failed",
            Self::Archived => "archived",
        }
    }

    pub fn transition_to(self, next: Self) -> Result<Self, DomainError> {
        let allowed = matches!(
            (self, next),
            (Self::Processing, Self::Ready | Self::Failed)
                | (Self::Ready, Self::Archived)
                | (Self::Failed, Self::Processing | Self::Archived)
        );

        allowed
            .then_some(next)
            .ok_or(DomainError::InvalidStateTransition {
                from: self.as_str(),
                to: next.as_str(),
            })
    }
}

impl FromStr for ReleaseStatus {
    type Err = DomainError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "processing" => Ok(Self::Processing),
            "ready" => Ok(Self::Ready),
            "failed" => Ok(Self::Failed),
            "archived" => Ok(Self::Archived),
            _ => Err(DomainError::InvalidReleaseStatus),
        }
    }
}
