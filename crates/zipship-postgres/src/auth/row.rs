use sqlx::FromRow;
use thiserror::Error;
use time::OffsetDateTime;
use uuid::Uuid;
use zipship_auth::{
    AuthRepositoryError, DisplayName, EncodedPasswordHash, NormalizedEmail, ResolvedSession,
    StoredUser, TokenDigest,
};

#[derive(Debug, FromRow)]
pub(super) struct UserRow {
    pub(super) id: Uuid,
    pub(super) email: String,
    pub(super) display_name: String,
    pub(super) password_hash: String,
    pub(super) disabled_at: Option<OffsetDateTime>,
}

impl TryFrom<UserRow> for StoredUser {
    type Error = AuthRepositoryError;

    fn try_from(row: UserRow) -> Result<Self, Self::Error> {
        Ok(Self {
            id: row.id,
            email: NormalizedEmail::parse(&row.email).map_err(|_| corrupt_record("users.email"))?,
            display_name: DisplayName::parse(&row.display_name)
                .map_err(|_| corrupt_record("users.display_name"))?,
            password_hash: EncodedPasswordHash::parse(row.password_hash)
                .map_err(|_| corrupt_record("users.password_hash"))?,
            disabled_at: row.disabled_at,
        })
    }
}

#[derive(Debug, FromRow)]
pub(super) struct ResolvedSessionRow {
    pub(super) session_id: Uuid,
    pub(super) csrf_secret_hash: Vec<u8>,
    pub(super) user_id: Uuid,
    pub(super) email: String,
    pub(super) display_name: String,
    pub(super) password_hash: String,
    pub(super) disabled_at: Option<OffsetDateTime>,
}

impl TryFrom<ResolvedSessionRow> for ResolvedSession {
    type Error = AuthRepositoryError;

    fn try_from(row: ResolvedSessionRow) -> Result<Self, Self::Error> {
        let csrf_digest = TokenDigest::from_slice(&row.csrf_secret_hash)
            .ok_or_else(|| corrupt_record("web_sessions.csrf_secret_hash"))?;
        let user = StoredUser::try_from(UserRow {
            id: row.user_id,
            email: row.email,
            display_name: row.display_name,
            password_hash: row.password_hash,
            disabled_at: row.disabled_at,
        })?;
        Ok(Self {
            session_id: row.session_id,
            user,
            csrf_digest,
        })
    }
}

#[derive(Debug, Error)]
#[error("database contains an invalid authentication value in {field}")]
struct CorruptAuthRecord {
    field: &'static str,
}

fn corrupt_record(field: &'static str) -> AuthRepositoryError {
    AuthRepositoryError::unavailable(CorruptAuthRecord { field })
}
