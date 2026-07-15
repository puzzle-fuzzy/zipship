use crate::model::{
    ApiToken, ListApiTokens, NewApiToken, ResolveApiToken, ResolvedApiToken, RevokeApiToken,
};
use async_trait::async_trait;
use std::error::Error as StdError;
use thiserror::Error;
use time::OffsetDateTime;

#[derive(Debug, Error)]
pub enum ApiTokensRepositoryError {
    #[error("the user has reached the active api token limit")]
    LimitReached,
    #[error("api token was not found")]
    NotFound,
    #[error("the user account is disabled")]
    AccountDisabled,
    #[error("api token repository is unavailable")]
    Unavailable {
        #[source]
        source: Box<dyn StdError + Send + Sync>,
    },
}

impl ApiTokensRepositoryError {
    pub fn unavailable(source: impl StdError + Send + Sync + 'static) -> Self {
        Self::Unavailable {
            source: Box::new(source),
        }
    }
}

#[async_trait]
pub trait ApiTokensRepository: Send + Sync + 'static {
    async fn create_token(
        &self,
        token: NewApiToken,
        active_token_limit: u16,
    ) -> Result<ApiToken, ApiTokensRepositoryError>;

    async fn list_tokens(
        &self,
        request: ListApiTokens,
    ) -> Result<Vec<ApiToken>, ApiTokensRepositoryError>;

    async fn revoke_token(
        &self,
        request: RevokeApiToken,
    ) -> Result<ApiToken, ApiTokensRepositoryError>;

    async fn resolve_token(
        &self,
        request: ResolveApiToken,
    ) -> Result<Option<ResolvedApiToken>, ApiTokensRepositoryError>;
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
