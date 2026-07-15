use super::*;
use async_trait::async_trait;
use secrecy::ExposeSecret;
use std::sync::Arc;
use std::sync::Mutex;
use time::{Duration, OffsetDateTime};
use uuid::Uuid;

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
        ApiTokenScopes::parse(&["uploads:write".to_owned(), "projects:read".to_owned()]).unwrap();
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
