use async_trait::async_trait;
use serde_json::Value;
use sqlx::{FromRow, PgPool};
use time::OffsetDateTime;
use uuid::Uuid;
use zipship_audit::{
    AuditActor, AuditEntry, AuditPage, AuditPageRequest, AuditRepository, AuditRepositoryError,
};

#[derive(Clone)]
pub struct PgAuditRepository {
    pool: PgPool,
}

impl PgAuditRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl AuditRepository for PgAuditRepository {
    async fn list(&self, request: AuditPageRequest) -> Result<AuditPage, AuditRepositoryError> {
        let mut transaction = self
            .pool
            .begin()
            .await
            .map_err(AuditRepositoryError::unavailable)?;
        let authorized_organization: Option<Uuid> = sqlx::query_scalar(
            r#"
            SELECT organizations.id
            FROM organizations
            INNER JOIN memberships
                ON memberships.organization_id = organizations.id
               AND memberships.user_id = $2
            WHERE organizations.id = $1 AND organizations.deleted_at IS NULL
            FOR SHARE OF organizations, memberships
            "#,
        )
        .bind(request.organization_id)
        .bind(request.actor_id)
        .fetch_optional(&mut *transaction)
        .await
        .map_err(AuditRepositoryError::unavailable)?;
        if authorized_organization.is_none() {
            return Err(AuditRepositoryError::OrganizationNotFound);
        }

        let cursor = match request.cursor {
            Some(cursor_id) => Some(
                sqlx::query_as::<_, AuditCursorRow>(
                    r#"
                    SELECT created_at, id
                    FROM audit_logs
                    WHERE organization_id = $1
                      AND id = $2
                      AND ($3::uuid IS NULL OR project_id = $3)
                    "#,
                )
                .bind(request.organization_id)
                .bind(cursor_id)
                .bind(request.project_id)
                .fetch_optional(&mut *transaction)
                .await
                .map_err(AuditRepositoryError::unavailable)?
                .ok_or(AuditRepositoryError::InvalidCursor)?,
            ),
            None => None,
        };
        let cursor_created_at = cursor.as_ref().map(|cursor| cursor.created_at);
        let cursor_id = cursor.as_ref().map(|cursor| cursor.id);
        let mut rows = sqlx::query_as::<_, AuditRow>(
            r#"
            SELECT
                audit_logs.id,
                audit_logs.organization_id,
                audit_logs.project_id,
                audit_logs.actor_id,
                users.email AS actor_email,
                users.display_name AS actor_display_name,
                audit_logs.action,
                audit_logs.target_type,
                audit_logs.target_id,
                audit_logs.request_id,
                audit_logs.metadata,
                audit_logs.created_at
            FROM audit_logs
            LEFT JOIN users ON users.id = audit_logs.actor_id
            WHERE audit_logs.organization_id = $1
              AND ($2::uuid IS NULL OR audit_logs.project_id = $2)
              AND (
                    $3::timestamptz IS NULL
                    OR (audit_logs.created_at, audit_logs.id) < ($3, $4)
              )
            ORDER BY audit_logs.created_at DESC, audit_logs.id DESC
            LIMIT $5
            "#,
        )
        .bind(request.organization_id)
        .bind(request.project_id)
        .bind(cursor_created_at)
        .bind(cursor_id)
        .bind(i64::from(request.limit) + 1)
        .fetch_all(&mut *transaction)
        .await
        .map_err(AuditRepositoryError::unavailable)?;
        transaction
            .commit()
            .await
            .map_err(AuditRepositoryError::unavailable)?;

        let has_more = rows.len() > usize::from(request.limit);
        rows.truncate(usize::from(request.limit));
        let entries = rows
            .into_iter()
            .map(AuditRow::try_into_entry)
            .collect::<Result<Vec<_>, _>>()?;
        let next_cursor = if has_more {
            entries.last().map(|entry| entry.id)
        } else {
            None
        };
        Ok(AuditPage {
            entries,
            next_cursor,
        })
    }
}

#[derive(Debug, FromRow)]
struct AuditCursorRow {
    created_at: OffsetDateTime,
    id: Uuid,
}

#[derive(Debug, FromRow)]
struct AuditRow {
    id: Uuid,
    organization_id: Uuid,
    project_id: Option<Uuid>,
    actor_id: Option<Uuid>,
    actor_email: Option<String>,
    actor_display_name: Option<String>,
    action: String,
    target_type: String,
    target_id: Option<Uuid>,
    request_id: Option<Uuid>,
    metadata: Value,
    created_at: OffsetDateTime,
}

impl AuditRow {
    fn try_into_entry(self) -> Result<AuditEntry, AuditRepositoryError> {
        let actor = match (self.actor_id, self.actor_email, self.actor_display_name) {
            (Some(id), Some(email), Some(display_name)) => Some(AuditActor {
                id,
                email,
                display_name,
            }),
            (None, None, None) => None,
            _ => return Err(corrupt_record()),
        };
        if self.action.trim().is_empty()
            || self.target_type.trim().is_empty()
            || !self.metadata.is_object()
        {
            return Err(corrupt_record());
        }
        Ok(AuditEntry {
            id: self.id,
            organization_id: self.organization_id,
            project_id: self.project_id,
            actor,
            action: self.action,
            target_type: self.target_type,
            target_id: self.target_id,
            request_id: self.request_id,
            metadata: self.metadata,
            created_at: self.created_at,
        })
    }
}

fn corrupt_record() -> AuditRepositoryError {
    AuditRepositoryError::unavailable(CorruptAuditRecord)
}

#[derive(Debug)]
struct CorruptAuditRecord;

impl std::fmt::Display for CorruptAuditRecord {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("database returned an invalid audit record")
    }
}

impl std::error::Error for CorruptAuditRecord {}
