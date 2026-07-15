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
    async fn list(&self, _request: AuditPageRequest) -> Result<AuditPage, AuditRepositoryError> {
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
