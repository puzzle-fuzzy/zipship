use super::*;
use async_trait::async_trait;
use std::sync::{Arc, Mutex};
use time::OffsetDateTime;
use uuid::Uuid;

const NOW: OffsetDateTime = OffsetDateTime::UNIX_EPOCH;

#[derive(Default)]
struct StubRepository {
    command: Mutex<Option<NewDeployment>>,
    error: Mutex<Option<DeploymentsRepositoryError>>,
}

#[async_trait]
impl DeploymentsRepository for StubRepository {
    async fn execute(
        &self,
        deployment: NewDeployment,
    ) -> Result<DeploymentResult, DeploymentsRepositoryError> {
        if let Some(error) = self.error.lock().unwrap().take() {
            return Err(error);
        }
        *self.command.lock().unwrap() = Some(deployment.clone());
        Ok(DeploymentResult {
            deployment: Deployment {
                id: deployment.id,
                project_id: deployment.project_id,
                release_id: deployment.release_id,
                previous_release_id: None,
                action: deployment.action,
                status: DeploymentStatus::Succeeded,
                actor_id: deployment.actor_id,
                message: deployment.message,
                created_at: deployment.now,
                finished_at: deployment.now,
            },
            active_release_id: deployment.release_id,
            replayed: false,
        })
    }

    async fn list_for_project(
        &self,
        _project_id: Uuid,
        _actor_id: Uuid,
    ) -> Result<Vec<Deployment>, DeploymentsRepositoryError> {
        Ok(Vec::new())
    }
}

struct FixedClock;

impl Clock for FixedClock {
    fn now(&self) -> OffsetDateTime {
        NOW
    }
}

fn request() -> DeploymentRequest {
    DeploymentRequest {
        project_id: Uuid::from_u128(1),
        release_id: Uuid::from_u128(2),
        actor_id: Uuid::from_u128(3),
        idempotency_key: "deploy-request-1".to_owned(),
        message: Some("  Production release  ".to_owned()),
        request_id: Some(Uuid::from_u128(4)),
    }
}

#[tokio::test]
async fn normalizes_publish_and_rollback_commands() {
    let repository = Arc::new(StubRepository::default());
    let service = DeploymentsService::with_clock(repository.clone(), Arc::new(FixedClock));
    let published = service.publish(request()).await.unwrap();
    assert_eq!(published.deployment.action, DeploymentAction::Publish);
    let publish = repository.command.lock().unwrap().clone().unwrap();
    assert_eq!(publish.message.as_deref(), Some("Production release"));
    assert_eq!(publish.idempotency_key.as_str(), "deploy-request-1");
    assert_eq!(publish.now, NOW);

    let mut rollback = request();
    rollback.idempotency_key = "rollback-request-1".to_owned();
    let rolled_back = service.rollback(rollback).await.unwrap();
    assert_eq!(rolled_back.deployment.action, DeploymentAction::Rollback);
}

#[tokio::test]
async fn rejects_invalid_keys_and_messages_before_repository_access() {
    let repository = Arc::new(StubRepository::default());
    let service = DeploymentsService::with_clock(repository.clone(), Arc::new(FixedClock));
    let mut invalid_key = request();
    invalid_key.idempotency_key = "contains spaces".to_owned();
    assert_eq!(
        service.publish(invalid_key).await.unwrap_err(),
        DeploymentsError::InvalidInput
    );
    let mut invalid_message = request();
    invalid_message.message = Some("line\nbreak".to_owned());
    assert_eq!(
        service.publish(invalid_message).await.unwrap_err(),
        DeploymentsError::InvalidInput
    );
    assert!(repository.command.lock().unwrap().is_none());
}

#[tokio::test]
async fn preserves_stable_repository_error_codes() {
    let cases = [
        (
            DeploymentsRepositoryError::Forbidden,
            DeploymentsError::Forbidden,
        ),
        (
            DeploymentsRepositoryError::ReleaseNotReady,
            DeploymentsError::ReleaseNotReady,
        ),
        (
            DeploymentsRepositoryError::ReleaseNotRollbackable,
            DeploymentsError::ReleaseNotRollbackable,
        ),
        (
            DeploymentsRepositoryError::IdempotencyConflict,
            DeploymentsError::IdempotencyConflict,
        ),
    ];
    for (repository_error, expected) in cases {
        let repository = Arc::new(StubRepository::default());
        *repository.error.lock().unwrap() = Some(repository_error);
        let service = DeploymentsService::with_clock(repository, Arc::new(FixedClock));
        assert_eq!(service.publish(request()).await.unwrap_err(), expected);
    }
    assert_eq!(
        DeploymentsError::IdempotencyConflict.code(),
        "IDEMPOTENCY_KEY_REUSED"
    );
}
