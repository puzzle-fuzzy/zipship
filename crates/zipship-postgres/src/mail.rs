use async_trait::async_trait;
use sqlx::PgPool;
use time::{Duration, OffsetDateTime};
use uuid::Uuid;
use zipship_jobs::{JobLease, WorkerId};
use zipship_mail::{ClaimedMail, MailOutboxRepository, MailOutboxRepositoryError};
use zipship_recovery::SealedEnvelope;

mod row;

use row::{CandidateRow, OutboxRow, ResetRow, corrupt_outbox};

#[derive(Debug, Clone)]
pub struct PgMailOutboxRepository {
    pool: PgPool,
}

impl PgMailOutboxRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl MailOutboxRepository for PgMailOutboxRepository {
    async fn claim_next(
        &self,
        worker_id: &WorkerId,
        lease: JobLease,
        now: OffsetDateTime,
    ) -> Result<Option<ClaimedMail>, MailOutboxRepositoryError> {
        let candidate = sqlx::query_as::<_, CandidateRow>(
            r#"
            SELECT email_outbox.id, email_outbox.aggregate_id, password_reset_requests.user_id
            FROM email_outbox
            INNER JOIN password_reset_requests
                ON password_reset_requests.id = email_outbox.aggregate_id
            WHERE email_outbox.kind = 'password_reset'
              AND email_outbox.state = 'queued'
              AND email_outbox.next_attempt_at <= $1
            ORDER BY email_outbox.next_attempt_at, email_outbox.created_at, email_outbox.id
            LIMIT 1
            "#,
        )
        .bind(now)
        .fetch_optional(&self.pool)
        .await
        .map_err(MailOutboxRepositoryError::unavailable)?;
        let Some(candidate) = candidate else {
            return Ok(None);
        };

        let mut transaction = self
            .pool
            .begin()
            .await
            .map_err(MailOutboxRepositoryError::unavailable)?;
        let disabled_at = sqlx::query_scalar::<_, Option<OffsetDateTime>>(
            "SELECT disabled_at FROM users WHERE id = $1 FOR UPDATE",
        )
        .bind(candidate.user_id)
        .fetch_optional(&mut *transaction)
        .await
        .map_err(MailOutboxRepositoryError::unavailable)?;
        let Some(disabled_at) = disabled_at else {
            transaction
                .commit()
                .await
                .map_err(MailOutboxRepositoryError::unavailable)?;
            return Ok(None);
        };
        let reset = sqlx::query_as::<_, ResetRow>(
            r#"
            SELECT state, expires_at
            FROM password_reset_requests
            WHERE id = $1 AND user_id = $2
            FOR UPDATE
            "#,
        )
        .bind(candidate.aggregate_id)
        .bind(candidate.user_id)
        .fetch_optional(&mut *transaction)
        .await
        .map_err(MailOutboxRepositoryError::unavailable)?;
        let outbox = sqlx::query_as::<_, OutboxRow>(
            r#"
            SELECT key_id, nonce, ciphertext, state, attempts, max_attempts, next_attempt_at
            FROM email_outbox
            WHERE id = $1 AND aggregate_id = $2
            FOR UPDATE
            "#,
        )
        .bind(candidate.id)
        .bind(candidate.aggregate_id)
        .fetch_optional(&mut *transaction)
        .await
        .map_err(MailOutboxRepositoryError::unavailable)?;
        let (Some(reset), Some(outbox)) = (reset, outbox) else {
            transaction
                .commit()
                .await
                .map_err(MailOutboxRepositoryError::unavailable)?;
            return Ok(None);
        };
        if outbox.state != "queued" || outbox.next_attempt_at > now {
            transaction
                .commit()
                .await
                .map_err(MailOutboxRepositoryError::unavailable)?;
            return Ok(None);
        }
        if reset.state != "pending" || reset.expires_at <= now || disabled_at.is_some() {
            if reset.state == "pending" {
                let state = if reset.expires_at <= now {
                    "expired"
                } else {
                    "superseded"
                };
                sqlx::query(
                    "UPDATE password_reset_requests SET state = $2, resolved_at = $3 WHERE id = $1",
                )
                .bind(candidate.aggregate_id)
                .bind(state)
                .bind(now)
                .execute(&mut *transaction)
                .await
                .map_err(MailOutboxRepositoryError::unavailable)?;
            }
            cancel_outbox(&mut transaction, candidate.id, now).await?;
            transaction
                .commit()
                .await
                .map_err(MailOutboxRepositoryError::unavailable)?;
            return Ok(None);
        }
        if outbox.attempts >= outbox.max_attempts {
            fail_outbox(
                &mut transaction,
                candidate.id,
                "MAIL_ATTEMPTS_EXHAUSTED",
                now,
            )
            .await?;
            transaction
                .commit()
                .await
                .map_err(MailOutboxRepositoryError::unavailable)?;
            return Ok(None);
        }

        let attempt = outbox.attempts + 1;
        sqlx::query(
            r#"
            UPDATE email_outbox
            SET
                state = 'sending',
                attempts = $2,
                locked_by = $3,
                locked_until = $4,
                heartbeat_at = $5,
                last_error_code = NULL
            WHERE id = $1
            "#,
        )
        .bind(candidate.id)
        .bind(attempt)
        .bind(worker_id.as_str())
        .bind(now + Duration::seconds(lease.seconds()))
        .bind(now)
        .execute(&mut *transaction)
        .await
        .map_err(MailOutboxRepositoryError::unavailable)?;
        transaction
            .commit()
            .await
            .map_err(MailOutboxRepositoryError::unavailable)?;
        Ok(Some(ClaimedMail {
            outbox_id: candidate.id,
            request_id: candidate.aggregate_id,
            envelope: SealedEnvelope {
                key_id: outbox.key_id.ok_or_else(corrupt_outbox)?,
                nonce: outbox
                    .nonce
                    .ok_or_else(corrupt_outbox)?
                    .try_into()
                    .map_err(|_| corrupt_outbox())?,
                ciphertext: outbox.ciphertext.ok_or_else(corrupt_outbox)?,
            },
            attempt: u16::try_from(attempt).map_err(|_| corrupt_outbox())?,
            max_attempts: u16::try_from(outbox.max_attempts).map_err(|_| corrupt_outbox())?,
            expires_at: reset.expires_at,
        }))
    }

    async fn heartbeat(
        &self,
        outbox_id: Uuid,
        worker_id: &WorkerId,
        lease: JobLease,
        now: OffsetDateTime,
    ) -> Result<bool, MailOutboxRepositoryError> {
        let result = sqlx::query(
            r#"
            UPDATE email_outbox
            SET locked_until = $3, heartbeat_at = $4
            WHERE id = $1
              AND state = 'sending'
              AND locked_by = $2
              AND locked_until > $4
            "#,
        )
        .bind(outbox_id)
        .bind(worker_id.as_str())
        .bind(now + Duration::seconds(lease.seconds()))
        .bind(now)
        .execute(&self.pool)
        .await
        .map_err(MailOutboxRepositoryError::unavailable)?;
        Ok(result.rows_affected() == 1)
    }

    async fn mark_delivered(
        &self,
        outbox_id: Uuid,
        worker_id: &WorkerId,
        delivered_at: OffsetDateTime,
    ) -> Result<bool, MailOutboxRepositoryError> {
        let result = sqlx::query(
            r#"
            UPDATE email_outbox
            SET
                state = 'delivered',
                key_id = NULL,
                nonce = NULL,
                ciphertext = NULL,
                locked_by = NULL,
                locked_until = NULL,
                heartbeat_at = NULL,
                delivered_at = $3,
                finished_at = $3
            WHERE id = $1
              AND state = 'sending'
              AND locked_by = $2
              AND locked_until > $3
            "#,
        )
        .bind(outbox_id)
        .bind(worker_id.as_str())
        .bind(delivered_at)
        .execute(&self.pool)
        .await
        .map_err(MailOutboxRepositoryError::unavailable)?;
        Ok(result.rows_affected() == 1)
    }

    async fn mark_failed(
        &self,
        outbox_id: Uuid,
        worker_id: &WorkerId,
        error_code: &'static str,
        retry_at: Option<OffsetDateTime>,
        failed_at: OffsetDateTime,
    ) -> Result<bool, MailOutboxRepositoryError> {
        let result = if let Some(retry_at) = retry_at {
            sqlx::query(
                r#"
                UPDATE email_outbox
                SET
                    state = 'queued',
                    next_attempt_at = $4,
                    locked_by = NULL,
                    locked_until = NULL,
                    heartbeat_at = NULL,
                    last_error_code = $3
                WHERE id = $1
                  AND state = 'sending'
                  AND locked_by = $2
                  AND locked_until > $5
                "#,
            )
            .bind(outbox_id)
            .bind(worker_id.as_str())
            .bind(error_code)
            .bind(retry_at)
            .bind(failed_at)
            .execute(&self.pool)
            .await
        } else {
            sqlx::query(
                r#"
                UPDATE email_outbox
                SET
                    state = 'failed',
                    key_id = NULL,
                    nonce = NULL,
                    ciphertext = NULL,
                    locked_by = NULL,
                    locked_until = NULL,
                    heartbeat_at = NULL,
                    last_error_code = $3,
                    finished_at = $4
                WHERE id = $1
                  AND state = 'sending'
                  AND locked_by = $2
                  AND locked_until > $4
                "#,
            )
            .bind(outbox_id)
            .bind(worker_id.as_str())
            .bind(error_code)
            .bind(failed_at)
            .execute(&self.pool)
            .await
        }
        .map_err(MailOutboxRepositoryError::unavailable)?;
        Ok(result.rows_affected() == 1)
    }

    async fn sweep(&self, now: OffsetDateTime) -> Result<u64, MailOutboxRepositoryError> {
        let mut transaction = self
            .pool
            .begin()
            .await
            .map_err(MailOutboxRepositoryError::unavailable)?;
        let expired = sqlx::query_scalar::<_, Uuid>(
            r#"
            UPDATE password_reset_requests
            SET state = 'expired', resolved_at = $1
            WHERE state = 'pending' AND expires_at <= $1
            RETURNING id
            "#,
        )
        .bind(now)
        .fetch_all(&mut *transaction)
        .await
        .map_err(MailOutboxRepositoryError::unavailable)?;
        let disabled = sqlx::query_scalar::<_, Uuid>(
            r#"
            UPDATE password_reset_requests
            SET state = 'superseded', resolved_at = $1
            FROM users
            WHERE password_reset_requests.user_id = users.id
              AND password_reset_requests.state = 'pending'
              AND users.disabled_at IS NOT NULL
            RETURNING password_reset_requests.id
            "#,
        )
        .bind(now)
        .fetch_all(&mut *transaction)
        .await
        .map_err(MailOutboxRepositoryError::unavailable)?;
        let mut invalid_requests = expired;
        invalid_requests.extend(disabled);
        let cancelled = if invalid_requests.is_empty() {
            0
        } else {
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
            .bind(&invalid_requests)
            .bind(now)
            .execute(&mut *transaction)
            .await
            .map_err(MailOutboxRepositoryError::unavailable)?
            .rows_affected()
        };
        let retried = sqlx::query(
            r#"
            UPDATE email_outbox
            SET
                state = 'queued',
                next_attempt_at = $1,
                locked_by = NULL,
                locked_until = NULL,
                heartbeat_at = NULL,
                last_error_code = 'MAIL_LEASE_EXPIRED'
            WHERE state = 'sending'
              AND locked_until <= $1
              AND attempts < max_attempts
            "#,
        )
        .bind(now)
        .execute(&mut *transaction)
        .await
        .map_err(MailOutboxRepositoryError::unavailable)?
        .rows_affected();
        let failed = sqlx::query(
            r#"
            UPDATE email_outbox
            SET
                state = 'failed',
                key_id = NULL,
                nonce = NULL,
                ciphertext = NULL,
                locked_by = NULL,
                locked_until = NULL,
                heartbeat_at = NULL,
                last_error_code = 'MAIL_ATTEMPTS_EXHAUSTED',
                finished_at = $1
            WHERE state = 'sending'
              AND locked_until <= $1
              AND attempts >= max_attempts
            "#,
        )
        .bind(now)
        .execute(&mut *transaction)
        .await
        .map_err(MailOutboxRepositoryError::unavailable)?
        .rows_affected();
        transaction
            .commit()
            .await
            .map_err(MailOutboxRepositoryError::unavailable)?;
        Ok(cancelled + retried + failed)
    }
}

async fn cancel_outbox(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    outbox_id: Uuid,
    cancelled_at: OffsetDateTime,
) -> Result<(), MailOutboxRepositoryError> {
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
        WHERE id = $1 AND state IN ('queued', 'sending')
        "#,
    )
    .bind(outbox_id)
    .bind(cancelled_at)
    .execute(&mut **transaction)
    .await
    .map_err(MailOutboxRepositoryError::unavailable)?;
    Ok(())
}

async fn fail_outbox(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    outbox_id: Uuid,
    error_code: &'static str,
    failed_at: OffsetDateTime,
) -> Result<(), MailOutboxRepositoryError> {
    sqlx::query(
        r#"
        UPDATE email_outbox
        SET
            state = 'failed',
            key_id = NULL,
            nonce = NULL,
            ciphertext = NULL,
            locked_by = NULL,
            locked_until = NULL,
            heartbeat_at = NULL,
            last_error_code = $2,
            finished_at = $3
        WHERE id = $1 AND state = 'queued'
        "#,
    )
    .bind(outbox_id)
    .bind(error_code)
    .bind(failed_at)
    .execute(&mut **transaction)
    .await
    .map_err(MailOutboxRepositoryError::unavailable)?;
    Ok(())
}
