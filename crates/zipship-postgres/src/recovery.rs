use async_trait::async_trait;
use sqlx::PgPool;
use uuid::Uuid;
use zipship_recovery::{
    ConsumePasswordReset, NewPasswordReset, PasswordRecoveryRepository,
    PasswordRecoveryRepositoryError, PasswordResetRequestDisposition,
};

mod support;

use support::{
    PasswordResetRow, RecoveryUserRow, cancel_outbox, expire_pending_requests,
    resolve_pending_requests, resolve_request_and_cancel_outbox,
};

#[derive(Debug, Clone)]
pub struct PgPasswordRecoveryRepository {
    pool: PgPool,
}

impl PgPasswordRecoveryRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl PasswordRecoveryRepository for PgPasswordRecoveryRepository {
    async fn create_password_reset(
        &self,
        reset: NewPasswordReset,
    ) -> Result<PasswordResetRequestDisposition, PasswordRecoveryRepositoryError> {
        let mut transaction = self
            .pool
            .begin()
            .await
            .map_err(PasswordRecoveryRepositoryError::unavailable)?;
        let user = sqlx::query_as::<_, RecoveryUserRow>(
            r#"
            SELECT id, disabled_at
            FROM users
            WHERE email = $1
            FOR UPDATE
            "#,
        )
        .bind(reset.email.as_str())
        .fetch_optional(&mut *transaction)
        .await
        .map_err(PasswordRecoveryRepositoryError::unavailable)?;
        let Some(user) = user else {
            transaction
                .commit()
                .await
                .map_err(PasswordRecoveryRepositoryError::unavailable)?;
            return Ok(PasswordResetRequestDisposition::Suppressed);
        };
        if user.disabled_at.is_some() {
            resolve_pending_requests(&mut transaction, user.id, reset.requested_at, "superseded")
                .await?;
            transaction
                .commit()
                .await
                .map_err(PasswordRecoveryRepositoryError::unavailable)?;
            return Ok(PasswordResetRequestDisposition::Suppressed);
        }

        expire_pending_requests(&mut transaction, user.id, reset.requested_at).await?;
        let throttled = sqlx::query_scalar::<_, bool>(
            r#"
            SELECT
                EXISTS (
                    SELECT 1
                    FROM password_reset_requests
                    WHERE user_id = $1 AND requested_at > $2
                )
                OR (
                    SELECT count(*)
                    FROM password_reset_requests
                    WHERE user_id = $1 AND requested_at > $3
                ) >= $4
            "#,
        )
        .bind(user.id)
        .bind(reset.cooldown_since)
        .bind(reset.window_since)
        .bind(i64::from(reset.max_requests_in_window))
        .fetch_one(&mut *transaction)
        .await
        .map_err(PasswordRecoveryRepositoryError::unavailable)?;
        if throttled {
            transaction
                .commit()
                .await
                .map_err(PasswordRecoveryRepositoryError::unavailable)?;
            return Ok(PasswordResetRequestDisposition::Suppressed);
        }

        resolve_pending_requests(&mut transaction, user.id, reset.requested_at, "superseded")
            .await?;
        sqlx::query(
            r#"
            INSERT INTO password_reset_requests (
                id, user_id, token_hash, state, requested_at, expires_at
            )
            VALUES ($1, $2, $3, 'pending', $4, $5)
            "#,
        )
        .bind(reset.id)
        .bind(user.id)
        .bind(reset.token_digest.as_bytes().as_slice())
        .bind(reset.requested_at)
        .bind(reset.expires_at)
        .execute(&mut *transaction)
        .await
        .map_err(PasswordRecoveryRepositoryError::unavailable)?;
        sqlx::query(
            r#"
            INSERT INTO email_outbox (
                id,
                kind,
                aggregate_id,
                key_id,
                nonce,
                ciphertext,
                state,
                max_attempts,
                next_attempt_at,
                created_at
            )
            VALUES ($1, 'password_reset', $2, $3, $4, $5, 'queued', $6, $7, $7)
            "#,
        )
        .bind(reset.outbox_id)
        .bind(reset.id)
        .bind(reset.envelope.key_id)
        .bind(reset.envelope.nonce.as_slice())
        .bind(reset.envelope.ciphertext)
        .bind(
            i16::try_from(reset.outbox_max_attempts)
                .map_err(PasswordRecoveryRepositoryError::unavailable)?,
        )
        .bind(reset.requested_at)
        .execute(&mut *transaction)
        .await
        .map_err(PasswordRecoveryRepositoryError::unavailable)?;
        transaction
            .commit()
            .await
            .map_err(PasswordRecoveryRepositoryError::unavailable)?;
        Ok(PasswordResetRequestDisposition::Created)
    }

    async fn consume_password_reset(
        &self,
        reset: ConsumePasswordReset,
    ) -> Result<(), PasswordRecoveryRepositoryError> {
        let user_id = sqlx::query_scalar::<_, Uuid>(
            "SELECT user_id FROM password_reset_requests WHERE token_hash = $1",
        )
        .bind(reset.token_digest.as_bytes().as_slice())
        .fetch_optional(&self.pool)
        .await
        .map_err(PasswordRecoveryRepositoryError::unavailable)?
        .ok_or(PasswordRecoveryRepositoryError::InvalidToken)?;
        let mut transaction = self
            .pool
            .begin()
            .await
            .map_err(PasswordRecoveryRepositoryError::unavailable)?;
        let user = sqlx::query_as::<_, RecoveryUserRow>(
            r#"
            SELECT id, disabled_at
            FROM users
            WHERE id = $1
            FOR UPDATE
            "#,
        )
        .bind(user_id)
        .fetch_optional(&mut *transaction)
        .await
        .map_err(PasswordRecoveryRepositoryError::unavailable)?
        .ok_or(PasswordRecoveryRepositoryError::InvalidToken)?;
        let request = sqlx::query_as::<_, PasswordResetRow>(
            r#"
            SELECT id, state, expires_at
            FROM password_reset_requests
            WHERE user_id = $1 AND token_hash = $2
            FOR UPDATE
            "#,
        )
        .bind(user.id)
        .bind(reset.token_digest.as_bytes().as_slice())
        .fetch_optional(&mut *transaction)
        .await
        .map_err(PasswordRecoveryRepositoryError::unavailable)?
        .ok_or(PasswordRecoveryRepositoryError::InvalidToken)?;
        if request.state != "pending" {
            return Err(PasswordRecoveryRepositoryError::InvalidToken);
        }
        if user.disabled_at.is_some() {
            resolve_request_and_cancel_outbox(
                &mut transaction,
                request.id,
                reset.consumed_at,
                "superseded",
            )
            .await?;
            transaction
                .commit()
                .await
                .map_err(PasswordRecoveryRepositoryError::unavailable)?;
            return Err(PasswordRecoveryRepositoryError::InvalidToken);
        }
        if request.expires_at <= reset.consumed_at {
            resolve_request_and_cancel_outbox(
                &mut transaction,
                request.id,
                reset.consumed_at,
                "expired",
            )
            .await?;
            transaction
                .commit()
                .await
                .map_err(PasswordRecoveryRepositoryError::unavailable)?;
            return Err(PasswordRecoveryRepositoryError::InvalidToken);
        }

        sqlx::query("UPDATE users SET password_hash = $2, updated_at = $3 WHERE id = $1")
            .bind(user.id)
            .bind(reset.password_hash.as_str())
            .bind(reset.consumed_at)
            .execute(&mut *transaction)
            .await
            .map_err(PasswordRecoveryRepositoryError::unavailable)?;
        sqlx::query(
            "UPDATE password_reset_requests SET state = 'consumed', resolved_at = $2 WHERE id = $1",
        )
        .bind(request.id)
        .bind(reset.consumed_at)
        .execute(&mut *transaction)
        .await
        .map_err(PasswordRecoveryRepositoryError::unavailable)?;
        resolve_pending_requests(&mut transaction, user.id, reset.consumed_at, "superseded")
            .await?;
        cancel_outbox(&mut transaction, request.id, reset.consumed_at).await?;
        sqlx::query(
            r#"
            UPDATE web_sessions
            SET revoked_at = $2
            WHERE user_id = $1 AND revoked_at IS NULL
            "#,
        )
        .bind(user.id)
        .bind(reset.consumed_at)
        .execute(&mut *transaction)
        .await
        .map_err(PasswordRecoveryRepositoryError::unavailable)?;
        sqlx::query(
            r#"
            UPDATE api_tokens
            SET revoked_at = GREATEST(
                $2,
                api_tokens.created_at,
                COALESCE(api_tokens.last_used_at, $2)
            )
            WHERE user_id = $1 AND revoked_at IS NULL
            "#,
        )
        .bind(user.id)
        .bind(reset.consumed_at)
        .execute(&mut *transaction)
        .await
        .map_err(PasswordRecoveryRepositoryError::unavailable)?;
        sqlx::query(
            r#"
            INSERT INTO audit_logs (
                organization_id,
                actor_id,
                action,
                target_type,
                target_id,
                metadata,
                created_at
            )
            SELECT
                memberships.organization_id,
                $1,
                'user.password_reset_completed',
                'user',
                $1,
                '{}'::jsonb,
                $2
            FROM memberships
            INNER JOIN organizations ON organizations.id = memberships.organization_id
            WHERE memberships.user_id = $1 AND organizations.deleted_at IS NULL
            "#,
        )
        .bind(user.id)
        .bind(reset.consumed_at)
        .execute(&mut *transaction)
        .await
        .map_err(PasswordRecoveryRepositoryError::unavailable)?;
        transaction
            .commit()
            .await
            .map_err(PasswordRecoveryRepositoryError::unavailable)
    }
}
