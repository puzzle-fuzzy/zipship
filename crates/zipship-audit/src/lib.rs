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
mod tests {
    use super::*;
    use std::sync::Mutex;

    #[derive(Default)]
    struct RecordingRepository {
        request: Mutex<Option<AuditPageRequest>>,
    }

    #[async_trait]
    impl AuditRepository for RecordingRepository {
        async fn list(&self, request: AuditPageRequest) -> Result<AuditPage, AuditRepositoryError> {
            *self.request.lock().unwrap() = Some(request);
            Ok(AuditPage {
                entries: Vec::new(),
                next_cursor: None,
            })
        }
    }

    #[tokio::test]
    async fn validates_and_defaults_page_sizes_before_repository_access() {
        let repository = Arc::new(RecordingRepository::default());
        let service = AuditService::new(repository.clone());
        let base = ListAuditCommand {
            actor_id: Uuid::from_u128(1),
            organization_id: Uuid::from_u128(2),
            project_id: None,
            cursor: None,
            limit: None,
        };

        service.list(base).await.unwrap();
        assert_eq!(repository.request.lock().unwrap().unwrap().limit, 50);

        for limit in [0, 101] {
            assert_eq!(
                service
                    .list(ListAuditCommand {
                        limit: Some(limit),
                        ..base
                    })
                    .await
                    .unwrap_err(),
                AuditError::InvalidQuery
            );
        }
    }

    struct InvalidCursorRepository;

    #[async_trait]
    impl AuditRepository for InvalidCursorRepository {
        async fn list(
            &self,
            _request: AuditPageRequest,
        ) -> Result<AuditPage, AuditRepositoryError> {
            Err(AuditRepositoryError::InvalidCursor)
        }
    }

    #[tokio::test]
    async fn preserves_stable_cursor_errors() {
        let service = AuditService::new(Arc::new(InvalidCursorRepository));
        let error = service
            .list(ListAuditCommand {
                actor_id: Uuid::nil(),
                organization_id: Uuid::nil(),
                project_id: None,
                cursor: Some(Uuid::from_u128(3)),
                limit: Some(25),
            })
            .await
            .unwrap_err();
        assert_eq!(error, AuditError::InvalidCursor);
        assert_eq!(error.code(), "INVALID_AUDIT_CURSOR");
    }
}
