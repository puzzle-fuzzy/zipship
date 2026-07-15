use crate::envelope::SealedEnvelope;
use time::OffsetDateTime;
use uuid::Uuid;
use zipship_auth::{EncodedPasswordHash, NormalizedEmail, TokenDigest};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PasswordResetState {
    Pending,
    Consumed,
    Superseded,
    Expired,
}

impl PasswordResetState {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Consumed => "consumed",
            Self::Superseded => "superseded",
            Self::Expired => "expired",
        }
    }
}

#[derive(Debug, Clone)]
pub struct NewPasswordReset {
    pub id: Uuid,
    pub outbox_id: Uuid,
    pub email: NormalizedEmail,
    pub token_digest: TokenDigest,
    pub envelope: SealedEnvelope,
    pub requested_at: OffsetDateTime,
    pub expires_at: OffsetDateTime,
    pub cooldown_since: OffsetDateTime,
    pub window_since: OffsetDateTime,
    pub max_requests_in_window: u16,
    pub outbox_max_attempts: u16,
}

#[derive(Debug, Clone)]
pub struct ConsumePasswordReset {
    pub token_digest: TokenDigest,
    pub password_hash: EncodedPasswordHash,
    pub consumed_at: OffsetDateTime,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PasswordResetRequestDisposition {
    Created,
    Suppressed,
}
