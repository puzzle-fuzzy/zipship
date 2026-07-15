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
mod tests {
    use super::*;
    use std::sync::Mutex;

    const NOW: OffsetDateTime = OffsetDateTime::UNIX_EPOCH;

    #[derive(Default)]
    struct TestRepository {
        creations: Mutex<Vec<(NewApiToken, u16)>>,
        listings: Mutex<Vec<ListApiTokens>>,
        revocations: Mutex<Vec<RevokeApiToken>>,
        resolutions: Mutex<Vec<ResolveApiToken>>,
        resolved: Mutex<Option<ResolvedApiToken>>,
    }

    #[async_trait]
    impl ApiTokensRepository for TestRepository {
        async fn create_token(
            &self,
            token: NewApiToken,
            active_token_limit: u16,
        ) -> Result<ApiToken, ApiTokensRepositoryError> {
            let stored = token_view(&token);
            self.creations
                .lock()
                .unwrap()
                .push((token, active_token_limit));
            Ok(stored)
        }

        async fn list_tokens(
            &self,
            request: ListApiTokens,
        ) -> Result<Vec<ApiToken>, ApiTokensRepositoryError> {
            self.listings.lock().unwrap().push(request);
            Ok(Vec::new())
        }

        async fn revoke_token(
            &self,
            request: RevokeApiToken,
        ) -> Result<ApiToken, ApiTokensRepositoryError> {
            let token = token_fixture(request.token_id, request.user_id, Some(request.revoked_at));
            self.revocations.lock().unwrap().push(request);
            Ok(token)
        }

        async fn resolve_token(
            &self,
            request: ResolveApiToken,
        ) -> Result<Option<ResolvedApiToken>, ApiTokensRepositoryError> {
            self.resolutions.lock().unwrap().push(request);
            Ok(self.resolved.lock().unwrap().clone())
        }
    }

    struct FixedClock;

    impl Clock for FixedClock {
        fn now(&self) -> OffsetDateTime {
            NOW
        }
    }

    fn service(repository: Arc<TestRepository>) -> ApiTokensService {
        ApiTokensService::with_clock(repository, Arc::new(FixedClock))
    }

    fn token_view(token: &NewApiToken) -> ApiToken {
        ApiToken {
            id: token.id,
            user_id: token.user_id,
            name: token.name.as_str().to_owned(),
            display_prefix: token.display_prefix.clone(),
            scopes: token.scopes.as_slice().to_vec(),
            expires_at: token.expires_at,
            last_used_at: None,
            revoked_at: None,
            created_at: token.created_at,
        }
    }

    fn token_fixture(id: Uuid, user_id: Uuid, revoked_at: Option<OffsetDateTime>) -> ApiToken {
        ApiToken {
            id,
            user_id,
            name: "CI deploy".to_owned(),
            display_prefix: "zps_12345678".to_owned(),
            scopes: vec![ApiTokenScope::ProjectsRead, ApiTokenScope::UploadsWrite],
            expires_at: NOW + Duration::days(90),
            last_used_at: None,
            revoked_at,
            created_at: NOW,
        }
    }

    #[test]
    fn validates_names_scopes_and_expiration_bounds() {
        assert_eq!(
            ApiTokenName::parse(" CI deploy ").unwrap().as_str(),
            "CI deploy"
        );
        assert_eq!(
            ApiTokenName::parse("line\nbreak"),
            Err(ApiTokenValidationError::InvalidName),
        );
        assert_eq!(
            ApiTokenName::parse(&"x".repeat(API_TOKEN_NAME_MAX_CHARS + 1)),
            Err(ApiTokenValidationError::InvalidName),
        );

        let scopes =
            ApiTokenScopes::parse(&["uploads:write".to_owned(), "projects:read".to_owned()])
                .unwrap();
        assert_eq!(
            scopes.as_slice(),
            &[ApiTokenScope::ProjectsRead, ApiTokenScope::UploadsWrite],
        );
        assert!(scopes.allows(ApiTokenScope::ProjectsRead));
        assert!(!scopes.allows(ApiTokenScope::DeploymentsWrite));
        assert_eq!(
            ApiTokenScopes::parse(&["projects:read".to_owned(), "projects:read".to_owned()]),
            Err(ApiTokenValidationError::InvalidScopes),
        );
        assert_eq!(
            ApiTokenScopes::parse(&["admin".to_owned()]),
            Err(ApiTokenValidationError::InvalidScopes),
        );
    }

    #[test]
    fn generates_prefixed_redacted_credentials() {
        let credential = ApiTokenCredential::generate().unwrap();
        let secret = credential.secret().expose_secret();

        assert!(secret.starts_with(API_TOKEN_SECRET_PREFIX));
        assert_eq!(secret.len(), API_TOKEN_SECRET_PREFIX.len() + 43);
        assert_eq!(digest_valid_api_token(secret), Some(credential.digest()));
        assert_eq!(credential.display_prefix().len(), 12);
        assert!(digest_valid_api_token("not-a-token").is_none());
        assert!(digest_valid_api_token(&format!("zps_{}", "a".repeat(43))).is_none());
        assert!(!format!("{credential:?}").contains(secret));
    }

    #[tokio::test]
    async fn creates_typed_expiring_tokens_and_returns_the_secret_once() {
        let repository = Arc::new(TestRepository::default());
        let user_id = Uuid::new_v4();
        let issued = service(repository.clone())
            .create(CreateApiTokenCommand {
                user_id,
                name: " CI deploy ".to_owned(),
                scopes: vec!["uploads:write".to_owned(), "projects:read".to_owned()],
                expires_in_days: 90,
            })
            .await
            .unwrap();

        let creations = repository.creations.lock().unwrap();
        assert_eq!(creations.len(), 1);
        let (created, limit) = &creations[0];
        assert_eq!(*limit, MAX_ACTIVE_API_TOKENS_PER_USER);
        assert_eq!(created.user_id, user_id);
        assert_eq!(created.name.as_str(), "CI deploy");
        assert_eq!(created.expires_at, NOW + Duration::days(90));
        assert_eq!(
            created.scopes.as_slice(),
            &[ApiTokenScope::ProjectsRead, ApiTokenScope::UploadsWrite],
        );
        assert_eq!(
            digest_valid_api_token(issued.secret.expose_secret()),
            Some(created.token_digest),
        );
        assert_eq!(issued.token.display_prefix, created.display_prefix);
        assert!(!format!("{issued:?}").contains(issued.secret.expose_secret()));
    }

    #[tokio::test]
    async fn rejects_invalid_create_inputs_before_generating_or_persisting() {
        let repository = Arc::new(TestRepository::default());
        let service = service(repository.clone());
        for command in [
            CreateApiTokenCommand {
                user_id: Uuid::new_v4(),
                name: "".to_owned(),
                scopes: vec!["projects:read".to_owned()],
                expires_in_days: 90,
            },
            CreateApiTokenCommand {
                user_id: Uuid::new_v4(),
                name: "CI".to_owned(),
                scopes: Vec::new(),
                expires_in_days: 90,
            },
            CreateApiTokenCommand {
                user_id: Uuid::new_v4(),
                name: "CI".to_owned(),
                scopes: vec!["projects:read".to_owned()],
                expires_in_days: 0,
            },
            CreateApiTokenCommand {
                user_id: Uuid::new_v4(),
                name: "CI".to_owned(),
                scopes: vec!["projects:read".to_owned()],
                expires_in_days: API_TOKEN_MAX_TTL_DAYS + 1,
            },
        ] {
            assert!(service.create(command).await.is_err());
        }
        assert!(repository.creations.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn forwards_owner_scoped_list_and_idempotent_revoke_requests() {
        let repository = Arc::new(TestRepository::default());
        let service = service(repository.clone());
        let user_id = Uuid::new_v4();
        let token_id = Uuid::new_v4();

        service.list(user_id).await.unwrap();
        let revoked = service
            .revoke(RevokeApiTokenCommand { user_id, token_id })
            .await
            .unwrap();

        let listings = repository.listings.lock().unwrap();
        assert_eq!(listings.len(), 1);
        assert_eq!(listings[0].user_id, user_id);
        assert_eq!(listings[0].now, NOW);
        let revocations = repository.revocations.lock().unwrap();
        assert_eq!(revocations.len(), 1);
        assert_eq!(revocations[0].user_id, user_id);
        assert_eq!(revocations[0].token_id, token_id);
        assert_eq!(revocations[0].revoked_at, NOW);
        assert_eq!(revoked.state_at(NOW), ApiTokenState::Revoked);
    }

    #[tokio::test]
    async fn rejects_malformed_secrets_before_repository_access() {
        let repository = Arc::new(TestRepository::default());
        let error = service(repository.clone())
            .authenticate("not-a-token")
            .await
            .unwrap_err();

        assert_eq!(error, ApiTokensError::Unauthenticated);
        assert!(repository.resolutions.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn authenticates_active_tokens_without_expanding_scopes() {
        let repository = Arc::new(TestRepository::default());
        let credential = ApiTokenCredential::generate().unwrap();
        let token = token_fixture(Uuid::new_v4(), Uuid::new_v4(), None);
        *repository.resolved.lock().unwrap() = Some(ResolvedApiToken {
            token: token.clone(),
            user_disabled_at: None,
        });

        let principal = service(repository.clone())
            .authenticate(credential.secret().expose_secret())
            .await
            .unwrap();

        assert_eq!(principal.token_id, token.id);
        assert_eq!(principal.user_id, token.user_id);
        assert!(principal.allows(ApiTokenScope::ProjectsRead));
        assert!(!principal.allows(ApiTokenScope::DeploymentsWrite));
        let resolutions = repository.resolutions.lock().unwrap();
        assert_eq!(resolutions.len(), 1);
        assert_eq!(resolutions[0].token_digest, credential.digest());
        assert_eq!(resolutions[0].used_at, NOW);
    }

    #[tokio::test]
    async fn collapses_disabled_expired_and_revoked_tokens_to_unauthenticated() {
        for (revoked_at, expires_at, disabled_at) in [
            (None, NOW + Duration::days(1), Some(NOW)),
            (None, NOW, None),
            (Some(NOW), NOW + Duration::days(1), None),
        ] {
            let repository = Arc::new(TestRepository::default());
            let credential = ApiTokenCredential::generate().unwrap();
            let mut token = token_fixture(Uuid::new_v4(), Uuid::new_v4(), revoked_at);
            token.expires_at = expires_at;
            *repository.resolved.lock().unwrap() = Some(ResolvedApiToken {
                token,
                user_disabled_at: disabled_at,
            });

            assert_eq!(
                service(repository)
                    .authenticate(credential.secret().expose_secret())
                    .await,
                Err(ApiTokensError::Unauthenticated),
            );
        }
    }

    #[test]
    fn exposes_stable_error_codes() {
        assert_eq!(ApiTokensError::InvalidName.code(), "INVALID_API_TOKEN_NAME");
        assert_eq!(
            ApiTokensError::InvalidScopes.code(),
            "INVALID_API_TOKEN_SCOPES"
        );
        assert_eq!(
            ApiTokensError::InvalidExpiration.code(),
            "INVALID_API_TOKEN_EXPIRATION",
        );
        assert_eq!(
            ApiTokensError::LimitReached.code(),
            "API_TOKEN_LIMIT_REACHED"
        );
        assert_eq!(ApiTokensError::NotFound.code(), "API_TOKEN_NOT_FOUND");
        assert_eq!(ApiTokensError::Unauthenticated.code(), "UNAUTHENTICATED");
    }
}
