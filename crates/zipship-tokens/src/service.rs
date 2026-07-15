use crate::{
    constants::{API_TOKEN_MAX_TTL_DAYS, API_TOKEN_MIN_TTL_DAYS, MAX_ACTIVE_API_TOKENS_PER_USER},
    credential::{
        ApiTokenCredential, ApiTokenName, ApiTokenScopes, ApiTokenValidationError,
        digest_valid_api_token,
    },
    error::ApiTokensError,
    model::{
        ApiToken, ApiTokenPrincipal, ApiTokenState, CreateApiTokenCommand, IssuedApiToken,
        ListApiTokens, NewApiToken, ResolveApiToken, RevokeApiToken, RevokeApiTokenCommand,
    },
    repository::{ApiTokensRepository, ApiTokensRepositoryError, Clock, SystemClock},
};
use std::sync::Arc;
use time::Duration;
use uuid::Uuid;

#[derive(Clone)]
pub struct ApiTokensService {
    repository: Arc<dyn ApiTokensRepository>,
    clock: Arc<dyn Clock>,
}

impl ApiTokensService {
    pub fn new(repository: Arc<dyn ApiTokensRepository>) -> Self {
        Self::with_clock(repository, Arc::new(SystemClock))
    }

    pub fn with_clock(repository: Arc<dyn ApiTokensRepository>, clock: Arc<dyn Clock>) -> Self {
        Self { repository, clock }
    }

    pub async fn create(
        &self,
        command: CreateApiTokenCommand,
    ) -> Result<IssuedApiToken, ApiTokensError> {
        let name = ApiTokenName::parse(&command.name).map_err(map_validation_error)?;
        let scopes = ApiTokenScopes::parse(&command.scopes).map_err(map_validation_error)?;
        if !(API_TOKEN_MIN_TTL_DAYS..=API_TOKEN_MAX_TTL_DAYS).contains(&command.expires_in_days) {
            return Err(ApiTokensError::InvalidExpiration);
        }
        let created_at = self.clock.now();
        let expires_at = created_at
            .checked_add(Duration::days(i64::from(command.expires_in_days)))
            .ok_or(ApiTokensError::Infrastructure)?;
        let credential = ApiTokenCredential::generate()?;
        let token = self
            .repository
            .create_token(
                NewApiToken {
                    id: Uuid::new_v4(),
                    user_id: command.user_id,
                    name,
                    display_prefix: credential.display_prefix().to_owned(),
                    scopes,
                    token_digest: credential.digest(),
                    expires_at,
                    created_at,
                },
                MAX_ACTIVE_API_TOKENS_PER_USER,
            )
            .await
            .map_err(map_repository_error)?;
        Ok(IssuedApiToken {
            token,
            secret: credential.into_secret(),
        })
    }

    pub async fn list(&self, user_id: Uuid) -> Result<Vec<ApiToken>, ApiTokensError> {
        self.repository
            .list_tokens(ListApiTokens {
                user_id,
                now: self.clock.now(),
            })
            .await
            .map_err(map_repository_error)
    }

    pub fn state(&self, token: &ApiToken) -> ApiTokenState {
        token.state_at(self.clock.now())
    }

    pub async fn revoke(&self, command: RevokeApiTokenCommand) -> Result<ApiToken, ApiTokensError> {
        self.repository
            .revoke_token(RevokeApiToken {
                user_id: command.user_id,
                token_id: command.token_id,
                revoked_at: self.clock.now(),
            })
            .await
            .map_err(map_repository_error)
    }

    pub async fn authenticate(&self, secret: &str) -> Result<ApiTokenPrincipal, ApiTokensError> {
        let token_digest = digest_valid_api_token(secret).ok_or(ApiTokensError::Unauthenticated)?;
        let now = self.clock.now();
        let resolved = self
            .repository
            .resolve_token(ResolveApiToken {
                token_digest,
                used_at: now,
            })
            .await
            .map_err(map_repository_error)?
            .ok_or(ApiTokensError::Unauthenticated)?;
        if resolved.user_disabled_at.is_some()
            || resolved.token.state_at(now) != ApiTokenState::Active
        {
            return Err(ApiTokensError::Unauthenticated);
        }
        let scopes = ApiTokenScopes::from_stored(resolved.token.scopes)
            .map_err(|_| ApiTokensError::Infrastructure)?;
        Ok(ApiTokenPrincipal {
            token_id: resolved.token.id,
            user_id: resolved.token.user_id,
            scopes,
        })
    }
}

fn map_validation_error(error: ApiTokenValidationError) -> ApiTokensError {
    match error {
        ApiTokenValidationError::InvalidName => ApiTokensError::InvalidName,
        ApiTokenValidationError::InvalidScopes => ApiTokensError::InvalidScopes,
        ApiTokenValidationError::InvalidExpiration => ApiTokensError::InvalidExpiration,
    }
}

fn map_repository_error(error: ApiTokensRepositoryError) -> ApiTokensError {
    match error {
        ApiTokensRepositoryError::LimitReached => ApiTokensError::LimitReached,
        ApiTokensRepositoryError::NotFound => ApiTokensError::NotFound,
        ApiTokensRepositoryError::AccountDisabled => ApiTokensError::Unauthenticated,
        ApiTokensRepositoryError::Unavailable { .. } => ApiTokensError::Infrastructure,
    }
}
