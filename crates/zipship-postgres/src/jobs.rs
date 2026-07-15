use async_trait::async_trait;
use serde_json::Value;
use sqlx::{FromRow, PgPool};
use std::str::FromStr;
use thiserror::Error;
use time::OffsetDateTime;
use uuid::Uuid;
use zipship_domain::{JobKind, JobStatus};
use zipship_jobs::{JobLease, JobRecord, JobsRepository, JobsRepositoryError, NewJob, WorkerId};

#[derive(Debug, Clone)]
pub struct PgJobsRepository {
    pool: PgPool,
}

impl PgJobsRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl JobsRepository for PgJobsRepository {
    async fn enqueue(&self, job: NewJob<'_>) -> Result<Uuid, JobsRepositoryError> {
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
        .map_err(JobsRepositoryError::unavailable)
    }

    async fn claim_next(
        &self,
        worker_id: &WorkerId,
        supported_kinds: &[JobKind],
        lease: JobLease,
    ) -> Result<Option<JobRecord>, JobsRepositoryError> {
        if supported_kinds.is_empty() {
            return Ok(None);
        }
        let supported_kinds = supported_kinds
            .iter()
            .copied()
            .map(JobKind::as_str)
            .collect::<Vec<_>>();
        let row = sqlx::query_as::<_, JobRow>(
            r#"
            WITH candidate AS (
                SELECT id
                FROM jobs
                WHERE status = 'queued'
                  AND next_run_at <= now()
                  AND kind = ANY($1)
                ORDER BY priority DESC, next_run_at, created_at, id
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
                finished_at = NULL,
                error_code = NULL,
                error_detail = NULL
            FROM candidate
            WHERE jobs.id = candidate.id
            RETURNING
                jobs.id, jobs.kind, jobs.domain_id, jobs.status,
                jobs.priority, jobs.attempts, jobs.max_attempts,
                jobs.next_run_at, jobs.locked_by, jobs.locked_until,
                jobs.heartbeat_at, jobs.input_json, jobs.output_json,
                jobs.error_code
            "#,
        )
        .bind(&supported_kinds)
        .bind(worker_id.as_str())
        .bind(lease.seconds())
        .fetch_optional(&self.pool)
        .await
        .map_err(JobsRepositoryError::unavailable)?;
        row.map(TryInto::try_into).transpose()
    }

    async fn heartbeat(
        &self,
        job_id: Uuid,
        worker_id: &WorkerId,
        lease: JobLease,
    ) -> Result<bool, JobsRepositoryError> {
        let result = sqlx::query(
            r#"
            UPDATE jobs
            SET heartbeat_at = now(),
                locked_until = now() + ($3 * interval '1 second')
            WHERE id = $1
              AND status = 'running'
              AND locked_by = $2
              AND locked_until > now()
            "#,
        )
        .bind(job_id)
        .bind(worker_id.as_str())
        .bind(lease.seconds())
        .execute(&self.pool)
        .await
        .map_err(JobsRepositoryError::unavailable)?;
        Ok(result.rows_affected() == 1)
    }

    async fn complete(
        &self,
        job_id: Uuid,
        worker_id: &WorkerId,
        output: &Value,
    ) -> Result<bool, JobsRepositoryError> {
        let result = sqlx::query(
            r#"
            UPDATE jobs
            SET status = 'succeeded',
                output_json = $3,
                error_code = NULL,
                error_detail = NULL,
                finished_at = now(),
                locked_by = NULL,
                locked_until = NULL,
                heartbeat_at = NULL
            WHERE id = $1
              AND status = 'running'
              AND locked_by = $2
              AND locked_until > now()
            "#,
        )
        .bind(job_id)
        .bind(worker_id.as_str())
        .bind(output)
        .execute(&self.pool)
        .await
        .map_err(JobsRepositoryError::unavailable)?;
        Ok(result.rows_affected() == 1)
    }

    async fn fail(
        &self,
        job_id: Uuid,
        worker_id: &WorkerId,
        error_code: &str,
        error_detail: &Value,
        retry_at: Option<OffsetDateTime>,
    ) -> Result<bool, JobsRepositoryError> {
        let result = sqlx::query(
            r#"
            UPDATE jobs
            SET status = CASE
                    WHEN $5 IS NOT NULL AND attempts < max_attempts THEN 'queued'
                    ELSE 'failed'
                END,
                next_run_at = CASE
                    WHEN $5 IS NOT NULL AND attempts < max_attempts THEN $5
                    ELSE next_run_at
                END,
                error_code = $3,
                error_detail = $4,
                finished_at = CASE
                    WHEN $5 IS NOT NULL AND attempts < max_attempts THEN NULL
                    ELSE now()
                END,
                locked_by = NULL,
                locked_until = NULL,
                heartbeat_at = NULL
            WHERE id = $1
              AND status = 'running'
              AND locked_by = $2
              AND locked_until > now()
            "#,
        )
        .bind(job_id)
        .bind(worker_id.as_str())
        .bind(error_code)
        .bind(error_detail)
        .bind(retry_at)
        .execute(&self.pool)
        .await
        .map_err(JobsRepositoryError::unavailable)?;
        Ok(result.rows_affected() == 1)
    }

    async fn sweep_expired_leases(&self) -> Result<u64, JobsRepositoryError> {
        let result = sqlx::query(
            r#"
            UPDATE jobs
            SET status = CASE
                    WHEN attempts < max_attempts THEN 'queued'
                    ELSE 'failed'
                END,
                locked_by = NULL,
                locked_until = NULL,
                heartbeat_at = NULL,
                next_run_at = CASE
                    WHEN attempts < max_attempts THEN
                        now() + make_interval(
                            secs => LEAST(
                                (1 << LEAST(GREATEST(attempts - 1, 0), 9)),
                                300
                            )
                        )
                    ELSE next_run_at
                END,
                error_code = 'WORKER_LEASE_EXPIRED',
                error_detail = jsonb_build_object('recoverable', attempts < max_attempts),
                finished_at = CASE
                    WHEN attempts >= max_attempts THEN now()
                    ELSE NULL
                END
            WHERE status = 'running' AND locked_until <= now()
            "#,
        )
        .execute(&self.pool)
        .await
        .map_err(JobsRepositoryError::unavailable)?;
        Ok(result.rows_affected())
    }
}

#[derive(Debug, FromRow)]
struct JobRow {
    id: Uuid,
    kind: String,
    domain_id: Option<Uuid>,
    status: String,
    priority: i16,
    attempts: i32,
    max_attempts: i32,
    next_run_at: OffsetDateTime,
    locked_by: Option<String>,
    locked_until: Option<OffsetDateTime>,
    heartbeat_at: Option<OffsetDateTime>,
    input_json: Value,
    output_json: Option<Value>,
    error_code: Option<String>,
}

impl TryFrom<JobRow> for JobRecord {
    type Error = JobsRepositoryError;

    fn try_from(row: JobRow) -> Result<Self, Self::Error> {
        if row.attempts < 0 || row.max_attempts <= 0 || row.attempts > row.max_attempts {
            return Err(corrupt_record("jobs.attempts"));
        }
        let status = JobStatus::from_str(&row.status).map_err(|_| corrupt_record("jobs.status"))?;
        if status == JobStatus::Running
            && (row.locked_by.is_none() || row.locked_until.is_none() || row.heartbeat_at.is_none())
        {
            return Err(corrupt_record("jobs.running_lease"));
        }
        Ok(Self {
            id: row.id,
            kind: JobKind::from_str(&row.kind).map_err(|_| corrupt_record("jobs.kind"))?,
            domain_id: row.domain_id,
            status,
            priority: row.priority,
            attempts: row.attempts,
            max_attempts: row.max_attempts,
            next_run_at: row.next_run_at,
            locked_by: row.locked_by,
            locked_until: row.locked_until,
            heartbeat_at: row.heartbeat_at,
            input: row.input_json,
            output: row.output_json,
            error_code: row.error_code,
        })
    }
}

#[derive(Debug, Error)]
#[error("database contains an invalid job value in {field}")]
struct CorruptJobRecord {
    field: &'static str,
}

fn corrupt_record(field: &'static str) -> JobsRepositoryError {
    JobsRepositoryError::unavailable(CorruptJobRecord { field })
}

#[cfg(test)]
mod tests;
