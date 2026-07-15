use async_trait::async_trait;
use serde_json::json;
use sqlx::{FromRow, PgPool, Postgres, Transaction};
use std::{fmt, str::FromStr};
use uuid::Uuid;
use zipship_deployments::{
    Deployment, DeploymentAction, DeploymentResult, DeploymentStatus, DeploymentsRepository,
    DeploymentsRepositoryError, NewDeployment,
};
use zipship_domain::{MemberRole, PermissionAction};

#[derive(Clone)]
pub struct PgDeploymentsRepository {
    pool: PgPool,
}

impl PgDeploymentsRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl DeploymentsRepository for PgDeploymentsRepository {
    async fn execute(
        &self,
        deployment: NewDeployment,
    ) -> Result<DeploymentResult, DeploymentsRepositoryError> {
        let mut transaction = self
            .pool
            .begin()
            .await
            .map_err(DeploymentsRepositoryError::unavailable)?;
        let project = lock_project(&mut transaction, deployment.project_id).await?;
        require_permission(
            &mut transaction,
            project.organization_id,
            deployment.actor_id,
            deployment.action,
        )
        .await?;

        if let Some(existing) = find_idempotent_deployment(
            &mut transaction,
            deployment.project_id,
            deployment.idempotency_key.as_str(),
        )
        .await?
        {
            let existing_deployment = existing.try_into_deployment()?;
            let same_request = existing_deployment.release_id == deployment.release_id
                && existing_deployment.actor_id == deployment.actor_id
                && existing_deployment.action == deployment.action
                && existing_deployment.message == deployment.message
                && existing_deployment.status == DeploymentStatus::Succeeded;
            if !same_request {
                return Err(DeploymentsRepositoryError::IdempotencyConflict);
            }
            let active_release_id = active_release(&mut transaction, deployment.project_id)
                .await?
                .ok_or_else(corrupt_record)?;
            transaction
                .commit()
                .await
                .map_err(DeploymentsRepositoryError::unavailable)?;
            return Ok(DeploymentResult {
                deployment: existing_deployment,
                active_release_id,
                replayed: true,
            });
        }

        lock_ready_release(
            &mut transaction,
            deployment.project_id,
            deployment.release_id,
        )
        .await?;
        let previous_release_id = active_release(&mut transaction, deployment.project_id).await?;
        if previous_release_id == Some(deployment.release_id) {
            return Err(DeploymentsRepositoryError::ReleaseAlreadyActive);
        }
        if deployment.action == DeploymentAction::Rollback
            && !was_previously_active(
                &mut transaction,
                deployment.project_id,
                deployment.release_id,
            )
            .await?
        {
            return Err(DeploymentsRepositoryError::ReleaseNotRollbackable);
        }

        sqlx::query(
            r#"
            INSERT INTO project_active_releases (project_id, release_id, updated_at)
            VALUES ($1, $2, $3)
            ON CONFLICT (project_id) DO UPDATE
            SET release_id = EXCLUDED.release_id,
                updated_at = EXCLUDED.updated_at
            "#,
        )
        .bind(deployment.project_id)
        .bind(deployment.release_id)
        .bind(deployment.now)
        .execute(&mut *transaction)
        .await
        .map_err(DeploymentsRepositoryError::unavailable)?;
        sqlx::query("UPDATE projects SET updated_at = $2 WHERE id = $1")
            .bind(deployment.project_id)
            .bind(deployment.now)
            .execute(&mut *transaction)
            .await
            .map_err(DeploymentsRepositoryError::unavailable)?;
        let row = sqlx::query_as::<_, DeploymentRow>(
            r#"
            INSERT INTO deployments (
                id, project_id, release_id, previous_release_id, action,
                status, idempotency_key, actor_id, message, created_at, finished_at
            )
            VALUES ($1, $2, $3, $4, $5, 'succeeded', $6, $7, $8, $9, $9)
            RETURNING
                id, project_id, release_id, previous_release_id, action,
                status, actor_id, message, created_at, finished_at
            "#,
        )
        .bind(deployment.id)
        .bind(deployment.project_id)
        .bind(deployment.release_id)
        .bind(previous_release_id)
        .bind(deployment.action.as_str())
        .bind(deployment.idempotency_key.as_str())
        .bind(deployment.actor_id)
        .bind(&deployment.message)
        .bind(deployment.now)
        .fetch_one(&mut *transaction)
        .await
        .map_err(DeploymentsRepositoryError::unavailable)?;
        sqlx::query(
            r#"
            INSERT INTO audit_logs (
                organization_id, project_id, actor_id, action,
                target_type, target_id, request_id, metadata, created_at
            )
            VALUES ($1, $2, $3, $4, 'release', $5, $6, $7, $8)
            "#,
        )
        .bind(project.organization_id)
        .bind(deployment.project_id)
        .bind(deployment.actor_id)
        .bind(deployment.action.audit_action())
        .bind(deployment.release_id)
        .bind(deployment.request_id)
        .bind(json!({
            "deploymentId": deployment.id,
            "releaseId": deployment.release_id,
            "previousReleaseId": previous_release_id,
            "idempotencyKey": deployment.idempotency_key.as_str(),
            "message": deployment.message,
        }))
        .bind(deployment.now)
        .execute(&mut *transaction)
        .await
        .map_err(DeploymentsRepositoryError::unavailable)?;
        transaction
            .commit()
            .await
            .map_err(DeploymentsRepositoryError::unavailable)?;

        Ok(DeploymentResult {
            deployment: row.try_into_deployment()?,
            active_release_id: deployment.release_id,
            replayed: false,
        })
    }

    async fn list_for_project(
        &self,
        project_id: Uuid,
        actor_id: Uuid,
    ) -> Result<Vec<Deployment>, DeploymentsRepositoryError> {
        let access = sqlx::query_as::<_, ProjectAccessRow>(
            r#"
            SELECT projects.id, memberships.role
            FROM projects
            INNER JOIN memberships
                ON memberships.organization_id = projects.organization_id
               AND memberships.user_id = $2
            WHERE projects.id = $1 AND projects.deleted_at IS NULL
            "#,
        )
        .bind(project_id)
        .bind(actor_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(DeploymentsRepositoryError::unavailable)?
        .ok_or(DeploymentsRepositoryError::ProjectNotFound)?;
        let role = MemberRole::from_str(&access.role).map_err(|_| corrupt_record())?;
        if !role.can(PermissionAction::ViewProject) {
            return Err(DeploymentsRepositoryError::Forbidden);
        }
        let rows = sqlx::query_as::<_, DeploymentRow>(
            r#"
            SELECT
                id, project_id, release_id, previous_release_id, action,
                status, actor_id, message, created_at, finished_at
            FROM deployments
            WHERE project_id = $1
            ORDER BY created_at DESC, id DESC
            "#,
        )
        .bind(project_id)
        .fetch_all(&self.pool)
        .await
        .map_err(DeploymentsRepositoryError::unavailable)?;
        rows.into_iter()
            .map(DeploymentRow::try_into_deployment)
            .collect()
    }
}

async fn lock_project(
    transaction: &mut Transaction<'_, Postgres>,
    project_id: Uuid,
) -> Result<ProjectRow, DeploymentsRepositoryError> {
    sqlx::query_as::<_, ProjectRow>(
        r#"
        SELECT id, organization_id
        FROM projects
        WHERE id = $1 AND deleted_at IS NULL
        FOR UPDATE
        "#,
    )
    .bind(project_id)
    .fetch_optional(&mut **transaction)
    .await
    .map_err(DeploymentsRepositoryError::unavailable)?
    .ok_or(DeploymentsRepositoryError::ProjectNotFound)
}

async fn require_permission(
    transaction: &mut Transaction<'_, Postgres>,
    organization_id: Uuid,
    actor_id: Uuid,
    action: DeploymentAction,
) -> Result<(), DeploymentsRepositoryError> {
    let role: Option<String> = sqlx::query_scalar(
        r#"
        SELECT role
        FROM memberships
        WHERE organization_id = $1 AND user_id = $2
        FOR SHARE
        "#,
    )
    .bind(organization_id)
    .bind(actor_id)
    .fetch_optional(&mut **transaction)
    .await
    .map_err(DeploymentsRepositoryError::unavailable)?;
    let role = role
        .ok_or(DeploymentsRepositoryError::Forbidden)
        .and_then(|role| MemberRole::from_str(&role).map_err(|_| corrupt_record()))?;
    let permission = match action {
        DeploymentAction::Publish => PermissionAction::PublishRelease,
        DeploymentAction::Rollback => PermissionAction::RollbackRelease,
    };
    if role.can(permission) {
        Ok(())
    } else {
        Err(DeploymentsRepositoryError::Forbidden)
    }
}

async fn find_idempotent_deployment(
    transaction: &mut Transaction<'_, Postgres>,
    project_id: Uuid,
    idempotency_key: &str,
) -> Result<Option<DeploymentRow>, DeploymentsRepositoryError> {
    sqlx::query_as::<_, DeploymentRow>(
        r#"
        SELECT
            id, project_id, release_id, previous_release_id, action,
            status, actor_id, message, created_at, finished_at
        FROM deployments
        WHERE project_id = $1 AND idempotency_key = $2
        "#,
    )
    .bind(project_id)
    .bind(idempotency_key)
    .fetch_optional(&mut **transaction)
    .await
    .map_err(DeploymentsRepositoryError::unavailable)
}

async fn lock_ready_release(
    transaction: &mut Transaction<'_, Postgres>,
    project_id: Uuid,
    release_id: Uuid,
) -> Result<(), DeploymentsRepositoryError> {
    let row = sqlx::query_as::<_, ReleaseReadinessRow>(
        r#"
        SELECT state AS release_state, artifact_id
        FROM releases
        WHERE project_id = $1 AND id = $2
        FOR SHARE
        "#,
    )
    .bind(project_id)
    .bind(release_id)
    .fetch_optional(&mut **transaction)
    .await
    .map_err(DeploymentsRepositoryError::unavailable)?
    .ok_or(DeploymentsRepositoryError::ReleaseNotFound)?;
    if row.release_state != "ready" {
        return Err(DeploymentsRepositoryError::ReleaseNotReady);
    }
    let artifact_id = row
        .artifact_id
        .ok_or(DeploymentsRepositoryError::ReleaseNotReady)?;
    let artifact_state: Option<String> =
        sqlx::query_scalar("SELECT state FROM artifacts WHERE id = $1 FOR SHARE")
            .bind(artifact_id)
            .fetch_optional(&mut **transaction)
            .await
            .map_err(DeploymentsRepositoryError::unavailable)?;
    if artifact_state.as_deref() == Some("ready") {
        Ok(())
    } else {
        Err(DeploymentsRepositoryError::ReleaseNotReady)
    }
}

async fn active_release(
    transaction: &mut Transaction<'_, Postgres>,
    project_id: Uuid,
) -> Result<Option<Uuid>, DeploymentsRepositoryError> {
    sqlx::query_scalar("SELECT release_id FROM project_active_releases WHERE project_id = $1")
        .bind(project_id)
        .fetch_optional(&mut **transaction)
        .await
        .map_err(DeploymentsRepositoryError::unavailable)
}

async fn was_previously_active(
    transaction: &mut Transaction<'_, Postgres>,
    project_id: Uuid,
    release_id: Uuid,
) -> Result<bool, DeploymentsRepositoryError> {
    sqlx::query_scalar(
        r#"
        SELECT EXISTS (
            SELECT 1
            FROM deployments
            WHERE project_id = $1
              AND release_id = $2
              AND status = 'succeeded'
        )
        "#,
    )
    .bind(project_id)
    .bind(release_id)
    .fetch_one(&mut **transaction)
    .await
    .map_err(DeploymentsRepositoryError::unavailable)
}

fn corrupt_record() -> DeploymentsRepositoryError {
    DeploymentsRepositoryError::unavailable(CorruptDeploymentRecord)
}

#[derive(Debug)]
struct CorruptDeploymentRecord;

impl fmt::Display for CorruptDeploymentRecord {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("database returned an invalid deployment record")
    }
}

impl std::error::Error for CorruptDeploymentRecord {}

#[derive(Debug, FromRow)]
struct ProjectRow {
    #[allow(dead_code)]
    id: Uuid,
    organization_id: Uuid,
}

#[derive(Debug, FromRow)]
struct ProjectAccessRow {
    #[allow(dead_code)]
    id: Uuid,
    role: String,
}

#[derive(Debug, FromRow)]
struct ReleaseReadinessRow {
    release_state: String,
    artifact_id: Option<Uuid>,
}

#[derive(Debug, FromRow)]
struct DeploymentRow {
    id: Uuid,
    project_id: Uuid,
    release_id: Uuid,
    previous_release_id: Option<Uuid>,
    action: String,
    status: String,
    actor_id: Uuid,
    message: Option<String>,
    created_at: time::OffsetDateTime,
    finished_at: time::OffsetDateTime,
}

impl DeploymentRow {
    fn try_into_deployment(self) -> Result<Deployment, DeploymentsRepositoryError> {
        Ok(Deployment {
            id: self.id,
            project_id: self.project_id,
            release_id: self.release_id,
            previous_release_id: self.previous_release_id,
            action: DeploymentAction::from_str(&self.action).map_err(|_| corrupt_record())?,
            status: DeploymentStatus::from_str(&self.status).map_err(|_| corrupt_record())?,
            actor_id: self.actor_id,
            message: self.message,
            created_at: self.created_at,
            finished_at: self.finished_at,
        })
    }
}
