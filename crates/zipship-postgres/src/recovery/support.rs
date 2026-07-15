use sqlx::{Postgres, Transaction};
use time::OffsetDateTime;
use uuid::Uuid;
use zipship_recovery::PasswordRecoveryRepositoryError;

pub(super) async fn expire_pending_requests(
    transaction: &mut Transaction<'_, Postgres>,
    user_id: Uuid,
    now: OffsetDateTime,
) -> Result<(), PasswordRecoveryRepositoryError> {
    let expired = sqlx::query_scalar::<_, Uuid>(
        r#"
        UPDATE password_reset_requests
        SET state = 'expired', resolved_at = $2
        WHERE user_id = $1 AND state = 'pending' AND expires_at <= $2
        RETURNING id
        "#,
    )
    .bind(user_id)
    .bind(now)
    .fetch_all(&mut **transaction)
    .await
    .map_err(PasswordRecoveryRepositoryError::unavailable)?;
    cancel_outboxes(transaction, &expired, now).await
}

pub(super) async fn resolve_pending_requests(
    transaction: &mut Transaction<'_, Postgres>,
    user_id: Uuid,
    resolved_at: OffsetDateTime,
    state: &'static str,
) -> Result<(), PasswordRecoveryRepositoryError> {
    debug_assert!(matches!(state, "superseded" | "expired"));
    let resolved = sqlx::query_scalar::<_, Uuid>(
        r#"
        UPDATE password_reset_requests
        SET state = $3, resolved_at = $2
        WHERE user_id = $1 AND state = 'pending'
        RETURNING id
        "#,
    )
    .bind(user_id)
    .bind(resolved_at)
    .bind(state)
    .fetch_all(&mut **transaction)
    .await
    .map_err(PasswordRecoveryRepositoryError::unavailable)?;
    cancel_outboxes(transaction, &resolved, resolved_at).await
}

pub(super) async fn resolve_request_and_cancel_outbox(
    transaction: &mut Transaction<'_, Postgres>,
    request_id: Uuid,
    resolved_at: OffsetDateTime,
    state: &'static str,
) -> Result<(), PasswordRecoveryRepositoryError> {
    debug_assert!(matches!(state, "superseded" | "expired"));
    sqlx::query("UPDATE password_reset_requests SET state = $2, resolved_at = $3 WHERE id = $1")
        .bind(request_id)
        .bind(state)
        .bind(resolved_at)
        .execute(&mut **transaction)
        .await
        .map_err(PasswordRecoveryRepositoryError::unavailable)?;
    cancel_outbox(transaction, request_id, resolved_at).await
}

async fn cancel_outboxes(
    transaction: &mut Transaction<'_, Postgres>,
    request_ids: &[Uuid],
    cancelled_at: OffsetDateTime,
) -> Result<(), PasswordRecoveryRepositoryError> {
    if request_ids.is_empty() {
        return Ok(());
    }
    sqlx::query(
        r#"
        UPDATE email_outbox
        SET
            state = 'cancelled',
            key_id = NULL,
            nonce = NULL,
            ciphertext = NULL,
            locked_by = NULL,
            locked_until = NULL,
            heartbeat_at = NULL,
            finished_at = $2
        WHERE aggregate_id = ANY($1) AND state IN ('queued', 'sending')
        "#,
    )
    .bind(request_ids)
    .bind(cancelled_at)
    .execute(&mut **transaction)
    .await
    .map_err(PasswordRecoveryRepositoryError::unavailable)?;
    Ok(())
}

pub(super) async fn cancel_outbox(
    transaction: &mut Transaction<'_, Postgres>,
    request_id: Uuid,
    cancelled_at: OffsetDateTime,
) -> Result<(), PasswordRecoveryRepositoryError> {
    cancel_outboxes(transaction, &[request_id], cancelled_at).await
}

#[derive(Debug, sqlx::FromRow)]
pub(super) struct RecoveryUserRow {
    pub(super) id: Uuid,
    pub(super) disabled_at: Option<OffsetDateTime>,
}

#[derive(Debug, sqlx::FromRow)]
pub(super) struct PasswordResetRow {
    pub(super) id: Uuid,
    pub(super) state: String,
    pub(super) expires_at: OffsetDateTime,
}
