#![forbid(unsafe_code)]

use async_trait::async_trait;
use serde_json::Value;
use std::{error::Error as StdError, fmt, time::Duration};
use thiserror::Error;
use time::OffsetDateTime;
use uuid::Uuid;
use zipship_domain::{JobKind, JobStatus};

const MAX_WORKER_ID_BYTES: usize = 160;
const MAX_LEASE_DURATION: Duration = Duration::from_secs(24 * 60 * 60);

#[derive(Debug, Clone, PartialEq)]
pub struct JobRecord {
    pub id: Uuid,
    pub kind: JobKind,
    pub domain_id: Option<Uuid>,
    pub status: JobStatus,
    pub priority: i16,
    pub attempts: i32,
    pub max_attempts: i32,
    pub next_run_at: OffsetDateTime,
    pub locked_by: Option<String>,
    pub locked_until: Option<OffsetDateTime>,
    pub heartbeat_at: Option<OffsetDateTime>,
    pub input: Value,
    pub output: Option<Value>,
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

#[derive(Clone, PartialEq, Eq, Hash)]
pub struct WorkerId(String);

impl WorkerId {
    pub fn parse(value: impl Into<String>) -> Result<Self, JobConfigurationError> {
        let value = value.into();
        let valid = !value.is_empty()
            && value.len() <= MAX_WORKER_ID_BYTES
            && value.trim() == value
            && !value.chars().any(char::is_control);
        valid
            .then_some(Self(value))
            .ok_or(JobConfigurationError::InvalidWorkerId)
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Debug for WorkerId {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.debug_tuple("WorkerId").field(&self.0).finish()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct JobLease(Duration);

impl JobLease {
    pub fn parse(duration: Duration) -> Result<Self, JobConfigurationError> {
        (duration > Duration::ZERO && duration <= MAX_LEASE_DURATION)
            .then_some(Self(duration))
            .ok_or(JobConfigurationError::InvalidLeaseDuration)
    }

    pub const fn duration(self) -> Duration {
        self.0
    }

    pub fn seconds(self) -> i64 {
        i64::try_from(self.0.as_secs()).expect("validated job lease duration always fits into i64")
    }
}

#[derive(Debug, Error, Clone, Copy, PartialEq, Eq)]
pub enum JobConfigurationError {
    #[error("worker ID is invalid")]
    InvalidWorkerId,
    #[error("job lease duration must be between one second and 24 hours")]
    InvalidLeaseDuration,
}

#[derive(Debug, Error)]
pub enum JobsRepositoryError {
    #[error("jobs repository is unavailable")]
    Unavailable {
        #[source]
        source: Box<dyn StdError + Send + Sync>,
    },
}

impl JobsRepositoryError {
    pub fn unavailable(source: impl StdError + Send + Sync + 'static) -> Self {
        Self::Unavailable {
            source: Box::new(source),
        }
    }
}

#[async_trait]
pub trait JobsRepository: Send + Sync + 'static {
    async fn enqueue(&self, job: NewJob<'_>) -> Result<Uuid, JobsRepositoryError>;

    async fn claim_next(
        &self,
        worker_id: &WorkerId,
        supported_kinds: &[JobKind],
        lease: JobLease,
    ) -> Result<Option<JobRecord>, JobsRepositoryError>;

    async fn heartbeat(
        &self,
        job_id: Uuid,
        worker_id: &WorkerId,
        lease: JobLease,
    ) -> Result<bool, JobsRepositoryError>;

    async fn complete(
        &self,
        job_id: Uuid,
        worker_id: &WorkerId,
        output: &Value,
    ) -> Result<bool, JobsRepositoryError>;

    async fn fail(
        &self,
        job_id: Uuid,
        worker_id: &WorkerId,
        error_code: &str,
        error_detail: &Value,
        retry_at: Option<OffsetDateTime>,
    ) -> Result<bool, JobsRepositoryError>;

    async fn sweep_expired_leases(&self) -> Result<u64, JobsRepositoryError>;
}

pub fn retry_delay(attempt: u32) -> Duration {
    let exponent = attempt.saturating_sub(1).min(9);
    Duration::from_secs(2_u64.pow(exponent).min(300))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn retry_backoff_is_exponential_and_capped_at_five_minutes() {
        assert_eq!(retry_delay(1), Duration::from_secs(1));
        assert_eq!(retry_delay(2), Duration::from_secs(2));
        assert_eq!(retry_delay(5), Duration::from_secs(16));
        assert_eq!(retry_delay(10), Duration::from_secs(300));
        assert_eq!(retry_delay(u32::MAX), Duration::from_secs(300));
    }

    #[test]
    fn validates_worker_identity_and_lease_bounds() {
        assert_eq!(
            WorkerId::parse(" worker-1"),
            Err(JobConfigurationError::InvalidWorkerId),
        );
        assert_eq!(
            WorkerId::parse("x".repeat(MAX_WORKER_ID_BYTES + 1)),
            Err(JobConfigurationError::InvalidWorkerId),
        );
        assert_eq!(
            JobLease::parse(Duration::ZERO),
            Err(JobConfigurationError::InvalidLeaseDuration),
        );
        assert_eq!(
            JobLease::parse(MAX_LEASE_DURATION + Duration::from_secs(1)),
            Err(JobConfigurationError::InvalidLeaseDuration),
        );
        assert_eq!(
            JobLease::parse(Duration::from_secs(60)).unwrap().seconds(),
            60,
        );
    }
}
