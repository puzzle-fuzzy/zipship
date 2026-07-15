use std::str::FromStr;

use serde::{Deserialize, Serialize};

use crate::DomainError;

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct UploadFilename(String);

impl UploadFilename {
    pub fn parse(value: impl AsRef<str>) -> Result<Self, DomainError> {
        let value = value.as_ref().trim();
        let valid = !value.is_empty()
            && value.len() <= 255
            && !matches!(value, "." | "..")
            && !value.contains(['/', '\\'])
            && !value.chars().any(char::is_control)
            && value.to_ascii_lowercase().ends_with(".zip");
        valid
            .then(|| Self(value.to_owned()))
            .ok_or(DomainError::InvalidUploadFilename)
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(transparent)]
pub struct UploadSize(u64);

impl UploadSize {
    pub fn parse(value: u64, maximum: u64) -> Result<Self, DomainError> {
        (value > 0 && value <= maximum)
            .then_some(Self(value))
            .ok_or(DomainError::InvalidUploadSize)
    }

    pub const fn bytes(self) -> u64 {
        self.0
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum UploadStatus {
    Pending,
    Receiving,
    Uploaded,
    Processing,
    Completed,
    Failed,
    Cancelled,
}

impl UploadStatus {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Receiving => "receiving",
            Self::Uploaded => "uploaded",
            Self::Processing => "processing",
            Self::Completed => "completed",
            Self::Failed => "failed",
            Self::Cancelled => "cancelled",
        }
    }

    pub fn transition_to(self, next: Self) -> Result<Self, DomainError> {
        let allowed = matches!(
            (self, next),
            (Self::Pending, Self::Receiving | Self::Cancelled)
                | (
                    Self::Receiving,
                    Self::Pending | Self::Uploaded | Self::Failed | Self::Cancelled
                )
                | (Self::Uploaded, Self::Processing | Self::Cancelled)
                | (Self::Processing, Self::Completed | Self::Failed)
        );
        allowed
            .then_some(next)
            .ok_or(DomainError::InvalidStateTransition {
                from: self.as_str(),
                to: next.as_str(),
            })
    }
}

impl FromStr for UploadStatus {
    type Err = DomainError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "pending" => Ok(Self::Pending),
            "receiving" => Ok(Self::Receiving),
            "uploaded" => Ok(Self::Uploaded),
            "processing" => Ok(Self::Processing),
            "completed" => Ok(Self::Completed),
            "failed" => Ok(Self::Failed),
            "cancelled" => Ok(Self::Cancelled),
            _ => Err(DomainError::InvalidUploadStatus),
        }
    }
}
