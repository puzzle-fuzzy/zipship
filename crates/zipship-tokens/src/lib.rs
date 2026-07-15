#![forbid(unsafe_code)]

use async_trait::async_trait;
use secrecy::{ExposeSecret, SecretString};
use std::{error::Error as StdError, fmt, str::FromStr, sync::Arc};
use thiserror::Error;
use time::{Duration, OffsetDateTime};
use uuid::Uuid;
use zipship_auth::{OpaqueToken, TokenDigest, digest_token, digest_valid_opaque_token};

pub const API_TOKEN_SECRET_PREFIX: &str = "zps_";
pub const API_TOKEN_NAME_MAX_CHARS: usize = 120;
pub const API_TOKEN_MIN_TTL_DAYS: u16 = 1;
pub const API_TOKEN_MAX_TTL_DAYS: u16 = 365;
pub const MAX_ACTIVE_API_TOKENS_PER_USER: u16 = 20;
pub const API_TOKEN_HISTORY_LIMIT: u16 = 100;

const API_TOKEN_DISPLAY_RANDOM_CHARS: usize = 8;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ApiTokenName(String);

impl ApiTokenName {
    pub fn parse(value: &str) -> Result<Self, ApiTokenValidationError> {
        let normalized = value.trim();
        let character_count = normalized.chars().count();
        if character_count == 0
            || character_count > API_TOKEN_NAME_MAX_CHARS
            || normalized.chars().any(char::is_control)
        {
            return Err(ApiTokenValidationError::InvalidName);
        }
        Ok(Self(normalized.to_owned()))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum ApiTokenScope {
    ProjectsRead,
    ReleasesRead,
    UploadsWrite,
    DeploymentsWrite,
}

impl ApiTokenScope {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::ProjectsRead => "projects:read",
            Self::ReleasesRead => "releases:read",
            Self::UploadsWrite => "uploads:write",
            Self::DeploymentsWrite => "deployments:write",
        }
    }

    pub const fn all() -> [Self; 4] {
        [
            Self::ProjectsRead,
            Self::ReleasesRead,
            Self::UploadsWrite,
            Self::DeploymentsWrite,
        ]
    }
}

impl FromStr for ApiTokenScope {
    type Err = ApiTokenValidationError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "projects:read" => Ok(Self::ProjectsRead),
            "releases:read" => Ok(Self::ReleasesRead),
            "uploads:write" => Ok(Self::UploadsWrite),
            "deployments:write" => Ok(Self::DeploymentsWrite),
            _ => Err(ApiTokenValidationError::InvalidScopes),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ApiTokenScopes(Vec<ApiTokenScope>);

impl ApiTokenScopes {
    pub fn parse(values: &[String]) -> Result<Self, ApiTokenValidationError> {
        if values.is_empty() || values.len() > ApiTokenScope::all().len() {
            return Err(ApiTokenValidationError::InvalidScopes);
        }
        let mut scopes = values
            .iter()
            .map(|value| ApiTokenScope::from_str(value))
            .collect::<Result<Vec<_>, _>>()?;
        scopes.sort_unstable();
        if scopes.windows(2).any(|pair| pair[0] == pair[1]) {
            return Err(ApiTokenValidationError::InvalidScopes);
        }
        Ok(Self(scopes))
    }

    pub fn from_stored(values: Vec<ApiTokenScope>) -> Result<Self, ApiTokenValidationError> {
        let strings = values
            .into_iter()
            .map(|scope| scope.as_str().to_owned())
            .collect::<Vec<_>>();
        Self::parse(&strings)
    }

    pub fn as_slice(&self) -> &[ApiTokenScope] {
        &self.0
    }

    pub fn allows(&self, required: ApiTokenScope) -> bool {
        self.0.binary_search(&required).is_ok()
    }
}

#[derive(Debug, Error, Clone, Copy, PartialEq, Eq)]
pub enum ApiTokenValidationError {
    #[error("api token name is invalid")]
    InvalidName,
    #[error("api token scopes are invalid")]
    InvalidScopes,
    #[error("api token expiration is invalid")]
    InvalidExpiration,
}

pub struct ApiTokenCredential {
    secret: SecretString,
    digest: TokenDigest,
    display_prefix: String,
}

impl ApiTokenCredential {
    pub fn generate() -> Result<Self, ApiTokensError> {
        let opaque = OpaqueToken::generate().map_err(|_| ApiTokensError::Infrastructure)?;
        let random_secret = opaque.secret().expose_secret();
        let secret = SecretString::from(format!("{API_TOKEN_SECRET_PREFIX}{random_secret}"));
        let digest = digest_token(secret.expose_secret());
        let display_prefix = format!(
            "{API_TOKEN_SECRET_PREFIX}{}",
            &random_secret[..API_TOKEN_DISPLAY_RANDOM_CHARS],
        );
        Ok(Self {
            secret,
            digest,
            display_prefix,
        })
    }

    pub fn secret(&self) -> &SecretString {
        &self.secret
    }

    pub fn digest(&self) -> TokenDigest {
        self.digest
    }

    pub fn display_prefix(&self) -> &str {
        &self.display_prefix
    }

    pub fn into_secret(self) -> SecretString {
        self.secret
    }
}

impl fmt::Debug for ApiTokenCredential {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ApiTokenCredential")
            .field("secret", &"[redacted]")
            .field("digest", &"[redacted]")
            .field("display_prefix", &self.display_prefix)
            .finish()
    }
}

pub fn digest_valid_api_token(value: &str) -> Option<TokenDigest> {
    let random_secret = value.strip_prefix(API_TOKEN_SECRET_PREFIX)?;
    digest_valid_opaque_token(random_secret)?;
    Some(digest_token(value))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ApiTokenState {
    Active,
    Expired,
    Revoked,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ApiToken {
    pub id: Uuid,
    pub user_id: Uuid,
    pub name: String,
    pub display_prefix: String,
    pub scopes: Vec<ApiTokenScope>,
    pub expires_at: OffsetDateTime,
    pub last_used_at: Option<OffsetDateTime>,
    pub revoked_at: Option<OffsetDateTime>,
    pub created_at: OffsetDateTime,
}

impl ApiToken {
    pub fn state_at(&self, now: OffsetDateTime) -> ApiTokenState {
        if self.revoked_at.is_some() {
            ApiTokenState::Revoked
        } else if self.expires_at <= now {
            ApiTokenState::Expired
        } else {
            ApiTokenState::Active
        }
    }
}

#[derive(Debug, Clone)]
pub struct NewApiToken {
    pub id: Uuid,
    pub user_id: Uuid,
    pub name: ApiTokenName,
    pub display_prefix: String,
    pub scopes: ApiTokenScopes,
    pub token_digest: TokenDigest,
    pub expires_at: OffsetDateTime,
    pub created_at: OffsetDateTime,
}

pub struct IssuedApiToken {
    pub token: ApiToken,
    pub secret: SecretString,
}

impl fmt::Debug for IssuedApiToken {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("IssuedApiToken")
            .field("token", &self.token)
            .field("secret", &"[redacted]")
            .finish()
    }
}

#[derive(Debug)]
pub struct CreateApiTokenCommand {
    pub user_id: Uuid,
    pub name: String,
    pub scopes: Vec<String>,
    pub expires_in_days: u16,
}

#[derive(Debug)]
pub struct ListApiTokens {
    pub user_id: Uuid,
    pub now: OffsetDateTime,
}

#[derive(Debug)]
pub struct RevokeApiToken {
    pub user_id: Uuid,
    pub token_id: Uuid,
    pub revoked_at: OffsetDateTime,
}

#[derive(Debug)]
pub struct RevokeApiTokenCommand {
    pub user_id: Uuid,
    pub token_id: Uuid,
}

#[derive(Debug)]
pub struct ResolveApiToken {
    pub token_digest: TokenDigest,
    pub used_at: OffsetDateTime,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedApiToken {
    pub token: ApiToken,
    pub user_disabled_at: Option<OffsetDateTime>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ApiTokenPrincipal {
    pub token_id: Uuid,
    pub user_id: Uuid,
    pub scopes: ApiTokenScopes,
}

impl ApiTokenPrincipal {
    pub fn allows(&self, required: ApiTokenScope) -> bool {
        self.scopes.allows(required)
    }
}

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

#[derive(Debug, Error, Clone, Copy, PartialEq, Eq)]
pub enum ApiTokensError {
    #[error("api token name is invalid")]
    InvalidName,
    #[error("api token scopes are invalid")]
    InvalidScopes,
    #[error("api token expiration is invalid")]
    InvalidExpiration,
    #[error("the user has reached the active api token limit")]
    LimitReached,
    #[error("api token was not found")]
    NotFound,
    #[error("api token authentication failed")]
    Unauthenticated,
    #[error("api token infrastructure failed")]
    Infrastructure,
}

impl ApiTokensError {
    pub const fn code(self) -> &'static str {
        match self {
            Self::InvalidName => "INVALID_API_TOKEN_NAME",
            Self::InvalidScopes => "INVALID_API_TOKEN_SCOPES",
            Self::InvalidExpiration => "INVALID_API_TOKEN_EXPIRATION",
            Self::LimitReached => "API_TOKEN_LIMIT_REACHED",
            Self::NotFound => "API_TOKEN_NOT_FOUND",
            Self::Unauthenticated => "UNAUTHENTICATED",
            Self::Infrastructure => "API_TOKENS_INFRASTRUCTURE_FAILURE",
        }
    }
}

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

#[cfg(test)]
mod tests;
