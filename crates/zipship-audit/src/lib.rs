#![forbid(unsafe_code)]

use async_trait::async_trait;
use serde_json::Value;
use std::{error::Error as StdError, sync::Arc};
use thiserror::Error;
use time::OffsetDateTime;
use uuid::Uuid;

pub const DEFAULT_PAGE_SIZE: u16 = 50;
pub const MAXIMUM_PAGE_SIZE: u16 = 100;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AuditActor {
    pub id: Uuid,
    pub email: String,
    pub display_name: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct AuditEntry {
    pub id: Uuid,
    pub organization_id: Uuid,
    pub project_id: Option<Uuid>,
    pub actor: Option<AuditActor>,
    pub action: String,
    pub target_type: String,
    pub target_id: Option<Uuid>,
    pub request_id: Option<Uuid>,
    pub metadata: Value,
    pub created_at: OffsetDateTime,
}

#[derive(Debug, Clone, PartialEq)]
pub struct AuditPage {
    pub entries: Vec<AuditEntry>,
    pub next_cursor: Option<Uuid>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AuditPageRequest {
    pub actor_id: Uuid,
    pub organization_id: Uuid,
    pub project_id: Option<Uuid>,
    pub cursor: Option<Uuid>,
    pub limit: u16,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ListAuditCommand {
    pub actor_id: Uuid,
    pub organization_id: Uuid,
    pub project_id: Option<Uuid>,
    pub cursor: Option<Uuid>,
    pub limit: Option<u16>,
}

#[derive(Debug, Error)]
pub enum AuditRepositoryError {
    #[error("organization was not found or is not visible")]
    OrganizationNotFound,
    #[error("audit cursor is invalid for this query")]
    InvalidCursor,
    #[error("audit repository is unavailable")]
    Unavailable {
        #[source]
        source: Box<dyn StdError + Send + Sync>,
    },
}

impl AuditRepositoryError {
    pub fn unavailable(source: impl StdError + Send + Sync + 'static) -> Self {
        Self::Unavailable {
            source: Box::new(source),
        }
    }
}

#[async_trait]
pub trait AuditRepository: Send + Sync + 'static {
    async fn list(&self, request: AuditPageRequest) -> Result<AuditPage, AuditRepositoryError>;
}

#[derive(Debug, Error, Clone, Copy, PartialEq, Eq)]
pub enum AuditError {
    #[error("audit query is invalid")]
    InvalidQuery,
    #[error("audit cursor is invalid for this query")]
    InvalidCursor,
    #[error("organization was not found or is not visible")]
    OrganizationNotFound,
    #[error("audit infrastructure failed")]
    Infrastructure,
}

impl AuditError {
    pub const fn code(self) -> &'static str {
        match self {
            Self::InvalidQuery => "INVALID_AUDIT_QUERY",
            Self::InvalidCursor => "INVALID_AUDIT_CURSOR",
            Self::OrganizationNotFound => "ORGANIZATION_NOT_FOUND",
            Self::Infrastructure => "AUDIT_INFRASTRUCTURE_FAILURE",
        }
    }
}

#[derive(Clone)]
pub struct AuditService {
    repository: Arc<dyn AuditRepository>,
}

impl AuditService {
    pub fn new(repository: Arc<dyn AuditRepository>) -> Self {
        Self { repository }
    }

    pub async fn list(&self, command: ListAuditCommand) -> Result<AuditPage, AuditError> {
        let limit = command.limit.unwrap_or(DEFAULT_PAGE_SIZE);
        if !(1..=MAXIMUM_PAGE_SIZE).contains(&limit) {
            return Err(AuditError::InvalidQuery);
        }
        self.repository
            .list(AuditPageRequest {
                actor_id: command.actor_id,
                organization_id: command.organization_id,
                project_id: command.project_id,
                cursor: command.cursor,
                limit,
            })
            .await
            .map_err(|error| match error {
                AuditRepositoryError::OrganizationNotFound => AuditError::OrganizationNotFound,
                AuditRepositoryError::InvalidCursor => AuditError::InvalidCursor,
                AuditRepositoryError::Unavailable { .. } => AuditError::Infrastructure,
            })
    }
}

#[cfg(test)]
mod tests;
