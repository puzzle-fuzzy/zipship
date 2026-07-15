use super::model::{NewPersonalOrganization, NewSession, NewUser, ResolvedSession, StoredUser};
use crate::{DisplayName, NormalizedEmail, TokenDigest};
use async_trait::async_trait;
use std::error::Error as StdError;
use thiserror::Error;
use time::OffsetDateTime;
use uuid::Uuid;

#[derive(Debug, Error)]
pub enum AuthRepositoryError {
    #[error("email already exists")]
    DuplicateEmail,
    #[error("user does not exist")]
    UserNotFound,
    #[error("authentication repository is unavailable")]
    Unavailable {
        #[source]
        source: Box<dyn StdError + Send + Sync>,
    },
}

impl AuthRepositoryError {
    pub fn unavailable(source: impl StdError + Send + Sync + 'static) -> Self {
        Self::Unavailable {
            source: Box::new(source),
        }
    }
}

#[async_trait]
pub trait AuthRepository: Send + Sync + 'static {
    async fn create_user_with_session(
        &self,
        user: NewUser,
        organization: NewPersonalOrganization,
        session: NewSession,
    ) -> Result<(), AuthRepositoryError>;

    async fn find_user_by_email(
        &self,
        email: &NormalizedEmail,
    ) -> Result<Option<StoredUser>, AuthRepositoryError>;

    async fn create_session(&self, session: NewSession) -> Result<(), AuthRepositoryError>;

    async fn update_display_name(
        &self,
        user_id: Uuid,
        display_name: DisplayName,
        updated_at: OffsetDateTime,
    ) -> Result<StoredUser, AuthRepositoryError>;

    async fn resolve_session(
        &self,
        token_digest: TokenDigest,
        now: OffsetDateTime,
    ) -> Result<Option<ResolvedSession>, AuthRepositoryError>;

    async fn revoke_session(
        &self,
        token_digest: TokenDigest,
        revoked_at: OffsetDateTime,
    ) -> Result<(), AuthRepositoryError>;
}

pub trait Clock: Send + Sync + 'static {
    fn now(&self) -> OffsetDateTime;
}

#[derive(Debug, Default)]
pub struct SystemClock;

impl Clock for SystemClock {
    fn now(&self) -> OffsetDateTime {
        OffsetDateTime::now_utc()
    }
}
