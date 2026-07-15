use sqlx::FromRow;
use time::OffsetDateTime;
use uuid::Uuid;
use zipship_mail::MailOutboxRepositoryError;

#[derive(Debug, FromRow)]
pub(super) struct CandidateRow {
    pub(super) id: Uuid,
    pub(super) aggregate_id: Uuid,
    pub(super) user_id: Uuid,
}

#[derive(Debug, FromRow)]
pub(super) struct ResetRow {
    pub(super) state: String,
    pub(super) expires_at: OffsetDateTime,
}

#[derive(Debug, FromRow)]
pub(super) struct OutboxRow {
    pub(super) key_id: Option<String>,
    pub(super) nonce: Option<Vec<u8>>,
    pub(super) ciphertext: Option<Vec<u8>>,
    pub(super) state: String,
    pub(super) attempts: i16,
    pub(super) max_attempts: i16,
    pub(super) next_attempt_at: OffsetDateTime,
}

pub(super) fn corrupt_outbox() -> MailOutboxRepositoryError {
    MailOutboxRepositoryError::unavailable(CorruptOutboxRecord)
}

#[derive(Debug, thiserror::Error)]
#[error("email outbox record violates its domain invariants")]
struct CorruptOutboxRecord;
