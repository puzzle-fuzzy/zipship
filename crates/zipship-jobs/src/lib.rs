#![forbid(unsafe_code)]

use serde_json::Value;
use sqlx::{FromRow, PgPool};
use std::time::Duration;
use time::OffsetDateTime;
use uuid::Uuid;
use zipship_domain::JobKind;

#[derive(Debug, Clone)]
pub struct JobRepository {
    pool: PgPool,
}

#[derive(Debug, Clone, FromRow)]
pub struct JobRecord {
    pub id: Uuid,
    pub kind: String,
    pub domain_id: Option<Uuid>,
    pub status: String,
    pub priority: i16,
    pub attempts: i32,
    pub max_attempts: i32,
    pub next_run_at: OffsetDateTime,
    pub locked_by: Option<String>,
    pub locked_until: Option<OffsetDateTime>,
    pub input_json: Value,
    pub output_json: Option<Value>,
    pub error_code: Option<String>,
}

#[derive(Debug, Clone)]
pub struct NewJob<'a> {
    pub kind: JobKind,
    pub domain_id: Option<Uuid>,
    pub dedupe_key: Option<&'a str>,
    pub priority: i16,
    pub max_attempts: i32,
    pub input: &'a Value,
}

impl JobRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    pub async fn enqueue(&self, job: NewJob<'_>) -> Result<Uuid, sqlx::Error> {
        let id = Uuid::new_v4();
        sqlx::query_scalar(
            r#"
            INSERT INTO jobs (
                id, kind, domain_id, dedupe_key, priority, max_attempts, input_json
            ) VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT (kind, dedupe_key) WHERE dedupe_key IS NOT NULL
            DO UPDATE SET dedupe_key = jobs.dedupe_key
            RETURNING id
            "#,
        )
        .bind(id)
        .bind(job.kind.as_str())
        .bind(job.domain_id)
        .bind(job.dedupe_key)
        .bind(job.priority)
        .bind(job.max_attempts)
        .bind(job.input)
        .fetch_one(&self.pool)
        .await
    }

    pub async fn claim_next(
        &self,
        worker_id: &str,
        supported_kinds: &[JobKind],
        lease_duration: Duration,
    ) -> Result<Option<JobRecord>, sqlx::Error> {
        let lease_seconds = i64::try_from(lease_duration.as_secs()).unwrap_or(i64::MAX);
        let supported_kinds = supported_kinds
            .iter()
            .copied()
            .map(JobKind::as_str)
            .collect::<Vec<_>>();
        sqlx::query_as::<_, JobRecord>(
            r#"
            WITH candidate AS (
                SELECT id
                FROM jobs
                WHERE status = 'queued'
                  AND next_run_at <= now()
                  AND kind = ANY($1)
                ORDER BY priority DESC, next_run_at, created_at
                FOR UPDATE SKIP LOCKED
                LIMIT 1
            )
            UPDATE jobs
            SET status = 'running',
                attempts = attempts + 1,
                locked_by = $2,
                locked_until = now() + ($3 * interval '1 second'),
                heartbeat_at = now(),
                started_at = COALESCE(started_at, now()),
                error_code = NULL,
                error_detail = NULL
            FROM candidate
            WHERE jobs.id = candidate.id
            RETURNING jobs.id, jobs.kind, jobs.domain_id, jobs.status,
                      jobs.priority, jobs.attempts, jobs.max_attempts,
                      jobs.next_run_at, jobs.locked_by, jobs.locked_until,
                      jobs.input_json, jobs.output_json, jobs.error_code
            "#,
        )
        .bind(&supported_kinds)
        .bind(worker_id)
        .bind(lease_seconds)
        .fetch_optional(&self.pool)
        .await
    }

    pub async fn heartbeat(
        &self,
        job_id: Uuid,
        worker_id: &str,
        lease_duration: Duration,
    ) -> Result<bool, sqlx::Error> {
        let lease_seconds = i64::try_from(lease_duration.as_secs()).unwrap_or(i64::MAX);
        let result = sqlx::query(
            r#"
            UPDATE jobs
            SET heartbeat_at = now(),
                locked_until = now() + ($3 * interval '1 second')
            WHERE id = $1 AND status = 'running' AND locked_by = $2
            "#,
        )
        .bind(job_id)
        .bind(worker_id)
        .bind(lease_seconds)
        .execute(&self.pool)
        .await?;
        Ok(result.rows_affected() == 1)
    }

    pub async fn complete(
        &self,
        job_id: Uuid,
        worker_id: &str,
        output: &Value,
    ) -> Result<bool, sqlx::Error> {
        let result = sqlx::query(
            r#"
            UPDATE jobs
            SET status = 'succeeded', output_json = $3, finished_at = now(),
                locked_by = NULL, locked_until = NULL, heartbeat_at = NULL
            WHERE id = $1 AND status = 'running' AND locked_by = $2
            "#,
        )
        .bind(job_id)
        .bind(worker_id)
        .bind(output)
        .execute(&self.pool)
        .await?;
        Ok(result.rows_affected() == 1)
    }

    pub async fn fail(
        &self,
        job_id: Uuid,
        worker_id: &str,
        error_code: &str,
        error_detail: &Value,
        retry_at: Option<OffsetDateTime>,
    ) -> Result<bool, sqlx::Error> {
        let result = sqlx::query(
            r#"
            UPDATE jobs
            SET status = CASE
                    WHEN $5 IS NOT NULL AND attempts < max_attempts THEN 'queued'
                    ELSE 'failed'
                END,
                next_run_at = COALESCE($5, next_run_at),
                error_code = $3,
                error_detail = $4,
                finished_at = CASE
                    WHEN $5 IS NULL OR attempts >= max_attempts THEN now()
                    ELSE NULL
                END,
                locked_by = NULL,
                locked_until = NULL,
                heartbeat_at = NULL
            WHERE id = $1 AND status = 'running' AND locked_by = $2
            "#,
        )
        .bind(job_id)
        .bind(worker_id)
        .bind(error_code)
        .bind(error_detail)
        .bind(retry_at)
        .execute(&self.pool)
        .await?;
        Ok(result.rows_affected() == 1)
    }

    pub async fn sweep_expired_leases(&self) -> Result<u64, sqlx::Error> {
        let result = sqlx::query(
            r#"
            UPDATE jobs
            SET status = CASE WHEN attempts < max_attempts THEN 'queued' ELSE 'failed' END,
                locked_by = NULL, locked_until = NULL,
                heartbeat_at = NULL, next_run_at = now(),
                error_code = 'WORKER_LEASE_EXPIRED',
                finished_at = CASE WHEN attempts >= max_attempts THEN now() ELSE NULL END
            WHERE status = 'running' AND locked_until < now()
            "#,
        )
        .execute(&self.pool)
        .await?;
        Ok(result.rows_affected())
    }
}

pub fn retry_delay(attempt: u32) -> Duration {
    let exponent = attempt.saturating_sub(1).min(8);
    Duration::from_secs(2_u64.pow(exponent).min(300))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn retry_backoff_is_exponential_and_capped() {
        assert_eq!(retry_delay(1), Duration::from_secs(1));
        assert_eq!(retry_delay(2), Duration::from_secs(2));
        assert_eq!(retry_delay(5), Duration::from_secs(16));
        assert_eq!(retry_delay(100), Duration::from_secs(256));
    }
}
