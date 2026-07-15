use serde::{Deserialize, Serialize};

use crate::{
    DomainError,
    normalization::{normalize_bounded_name, parse_slug},
};

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct OrganizationName(String);

impl OrganizationName {
    pub fn parse(value: impl AsRef<str>) -> Result<Self, DomainError> {
        normalize_bounded_name(value.as_ref(), 160)
            .map(Self)
            .ok_or(DomainError::InvalidOrganizationName)
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct OrganizationSlug(String);

impl OrganizationSlug {
    pub fn parse(value: impl AsRef<str>) -> Result<Self, DomainError> {
        parse_slug(value.as_ref(), false)
            .map(Self)
            .ok_or(DomainError::InvalidOrganizationSlug)
    }

    pub fn parse_normalized(value: impl AsRef<str>) -> Result<Self, DomainError> {
        Self::parse(value.as_ref().trim().to_ascii_lowercase())
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}
