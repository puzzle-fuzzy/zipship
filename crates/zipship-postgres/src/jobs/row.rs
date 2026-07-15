use serde_json::Value;
use sqlx::FromRow;
use std::str::FromStr;
use thiserror::Error;
use time::OffsetDateTime;
use uuid::Uuid;
use zipship_domain::{JobKind, JobStatus};
use zipship_jobs::{JobRecord, JobsRepositoryError};

#[derive(Debug, FromRow)]
pub(super) struct JobRow {
    pub(super) id: Uuid,
    pub(super) kind: String,
    pub(super) domain_id: Option<Uuid>,
    pub(super) status: String,
    pub(super) priority: i16,
    pub(super) attempts: i32,
    pub(super) max_attempts: i32,
    pub(super) next_run_at: OffsetDateTime,
    pub(super) locked_by: Option<String>,
    pub(super) locked_until: Option<OffsetDateTime>,
    pub(super) heartbeat_at: Option<OffsetDateTime>,
    pub(super) input_json: Value,
    pub(super) output_json: Option<Value>,
    pub(super) error_code: Option<String>,
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
