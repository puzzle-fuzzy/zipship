use std::{fmt, str::FromStr};

use serde::{Deserialize, Serialize};

use crate::{
    DomainError,
    normalization::{normalize_bounded_name, parse_slug},
};

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct ProjectName(String);

impl ProjectName {
    pub fn parse(value: impl AsRef<str>) -> Result<Self, DomainError> {
        normalize_bounded_name(value.as_ref(), 160)
            .map(Self)
            .ok_or(DomainError::InvalidProjectName)
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct ProjectDescription(Option<String>);

impl ProjectDescription {
    pub fn parse(value: Option<&str>) -> Result<Self, DomainError> {
        let Some(value) = value else {
            return Ok(Self(None));
        };
        let normalized = value.trim();
        if normalized.is_empty() {
            return Ok(Self(None));
        }
        if normalized.chars().count() > 2_000 || normalized.contains('\0') {
            return Err(DomainError::InvalidProjectDescription);
        }
        Ok(Self(Some(normalized.to_owned())))
    }

    pub fn as_deref(&self) -> Option<&str> {
        self.0.as_deref()
    }

    pub fn into_inner(self) -> Option<String> {
        self.0
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct ProjectSlug(String);

impl ProjectSlug {
    pub fn parse(value: impl AsRef<str>) -> Result<Self, DomainError> {
        parse_slug(value.as_ref(), true)
            .map(Self)
            .ok_or(DomainError::InvalidProjectSlug)
    }

    pub fn parse_normalized(value: impl AsRef<str>) -> Result<Self, DomainError> {
        Self::parse(value.as_ref().trim().to_ascii_lowercase())
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for ProjectSlug {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl FromStr for ProjectSlug {
    type Err = DomainError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        Self::parse(value)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CachePolicy {
    Standard,
    Aggressive,
}

impl CachePolicy {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Standard => "standard",
            Self::Aggressive => "aggressive",
        }
    }
}

impl FromStr for CachePolicy {
    type Err = DomainError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "standard" => Ok(Self::Standard),
            "aggressive" => Ok(Self::Aggressive),
            _ => Err(DomainError::InvalidCachePolicy),
        }
    }
}
