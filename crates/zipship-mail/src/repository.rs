use async_trait::async_trait;
use std::error::Error as StdError;
use thiserror::Error;
use time::OffsetDateTime;
use uuid::Uuid;
use zipship_jobs::{JobLease, WorkerId};
use zipship_recovery::SealedEnvelope;

#[derive(Debug, Clone)]
pub struct ClaimedMail {
    pub outbox_id: Uuid,
    pub request_id: Uuid,
    pub envelope: SealedEnvelope,
    pub attempt: u16,
    pub max_attempts: u16,
    pub expires_at: OffsetDateTime,
}

#[derive(Debug, Error)]
pub enum MailOutboxRepositoryError {
    #[error("mail outbox lease was lost")]
    LeaseLost,
    #[error("mail outbox repository is unavailable")]
    Unavailable {
        #[source]
        source: Box<dyn StdError + Send + Sync>,
    },
}

impl MailOutboxRepositoryError {
    pub fn unavailable(source: impl StdError + Send + Sync + 'static) -> Self {
        Self::Unavailable {
            source: Box::new(source),
        }
    }
}

#[async_trait]
pub trait MailOutboxRepository: Send + Sync + 'static {
    async fn claim_next(
        &self,
        worker_id: &WorkerId,
        lease: JobLease,
        now: OffsetDateTime,
    ) -> Result<Option<ClaimedMail>, MailOutboxRepositoryError>;

    async fn heartbeat(
        &self,
        outbox_id: Uuid,
        worker_id: &WorkerId,
        lease: JobLease,
        now: OffsetDateTime,
    ) -> Result<bool, MailOutboxRepositoryError>;

    async fn mark_delivered(
        &self,
        outbox_id: Uuid,
        worker_id: &WorkerId,
        delivered_at: OffsetDateTime,
    ) -> Result<bool, MailOutboxRepositoryError>;

    async fn mark_failed(
        &self,
        outbox_id: Uuid,
        worker_id: &WorkerId,
        error_code: &'static str,
        retry_at: Option<OffsetDateTime>,
        failed_at: OffsetDateTime,
    ) -> Result<bool, MailOutboxRepositoryError>;

    async fn sweep(&self, now: OffsetDateTime) -> Result<u64, MailOutboxRepositoryError>;
}
