use crate::{
    DisplayName, EncodedPasswordHash, IdentityValidationError, NormalizedEmail, PasswordEngine,
    SessionCredentials, TokenDigest, digest_token, validate_password, verify_token_digest,
};
use async_trait::async_trait;
use secrecy::SecretString;
use std::{error::Error as StdError, sync::Arc};
use thiserror::Error;
use time::{Duration, OffsetDateTime};
use uuid::Uuid;
use zipship_domain::{OrganizationName, OrganizationSlug};

const DEFAULT_SESSION_TTL: Duration = Duration::days(7);
const DUMMY_PASSWORD: &str = "zipship dummy credential value";

#[derive(Debug)]
pub struct RegisterCommand {
    pub email: String,
    pub display_name: String,
    pub password: SecretString,
}

#[derive(Debug)]
pub struct LoginCommand {
    pub email: String,
    pub password: SecretString,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UserProfile {
    pub id: Uuid,
    pub email: String,
    pub display_name: String,
}

#[derive(Debug)]
pub struct AuthOutcome {
    pub user: UserProfile,
    pub session_id: Uuid,
    pub credentials: SessionCredentials,
    pub expires_at: OffsetDateTime,
}

#[derive(Debug, Clone)]
pub struct NewUser {
    pub id: Uuid,
    pub email: NormalizedEmail,
    pub display_name: DisplayName,
    pub password_hash: EncodedPasswordHash,
    pub created_at: OffsetDateTime,
}

#[derive(Debug, Clone)]
pub struct NewSession {
    pub id: Uuid,
    pub user_id: Uuid,
    pub token_digest: TokenDigest,
    pub csrf_digest: TokenDigest,
    pub expires_at: OffsetDateTime,
    pub created_at: OffsetDateTime,
}

#[derive(Debug, Clone)]
pub struct NewPersonalOrganization {
    pub id: Uuid,
    pub name: OrganizationName,
    pub slug: OrganizationSlug,
    pub created_at: OffsetDateTime,
}

#[derive(Debug, Clone)]
pub struct StoredUser {
    pub id: Uuid,
    pub email: NormalizedEmail,
    pub display_name: DisplayName,
    pub password_hash: EncodedPasswordHash,
    pub disabled_at: Option<OffsetDateTime>,
}

#[derive(Debug, Clone)]
pub struct ResolvedSession {
    pub session_id: Uuid,
    pub user: StoredUser,
    pub csrf_digest: TokenDigest,
}

#[derive(Debug, Error)]
pub enum AuthRepositoryError {
    #[error("email already exists")]
    DuplicateEmail,
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

#[derive(Debug, Error, Clone, Copy, PartialEq, Eq)]
pub enum AuthError {
    #[error("invalid email")]
    InvalidEmail,
    #[error("invalid display name")]
    InvalidDisplayName,
    #[error("password does not satisfy the policy")]
    InvalidPassword,
    #[error("email already exists")]
    DuplicateEmail,
    #[error("invalid credentials")]
    InvalidCredentials,
    #[error("account is disabled")]
    AccountDisabled,
    #[error("authentication is required")]
    Unauthenticated,
    #[error("csrf token is invalid")]
    InvalidCsrfToken,
    #[error("authentication infrastructure failed")]
    Infrastructure,
}

impl AuthError {
    pub const fn code(self) -> &'static str {
        match self {
            Self::InvalidEmail => "INVALID_EMAIL",
            Self::InvalidDisplayName => "INVALID_DISPLAY_NAME",
            Self::InvalidPassword => "INVALID_PASSWORD",
            Self::DuplicateEmail => "DUPLICATE_EMAIL",
            Self::InvalidCredentials => "INVALID_CREDENTIALS",
            Self::AccountDisabled => "ACCOUNT_DISABLED",
            Self::Unauthenticated => "UNAUTHENTICATED",
            Self::InvalidCsrfToken => "INVALID_CSRF_TOKEN",
            Self::Infrastructure => "AUTH_INFRASTRUCTURE_FAILURE",
        }
    }
}

#[derive(Clone)]
pub struct AuthService {
    repository: Arc<dyn AuthRepository>,
    clock: Arc<dyn Clock>,
    password_engine: PasswordEngine,
    dummy_password_hash: EncodedPasswordHash,
    session_ttl: Duration,
}

impl AuthService {
    pub async fn new(repository: Arc<dyn AuthRepository>) -> Result<Self, AuthError> {
        Self::with_clock(repository, Arc::new(SystemClock), DEFAULT_SESSION_TTL).await
    }

    pub async fn with_clock(
        repository: Arc<dyn AuthRepository>,
        clock: Arc<dyn Clock>,
        session_ttl: Duration,
    ) -> Result<Self, AuthError> {
        let password_engine = PasswordEngine::default();
        let engine = password_engine.clone();
        let dummy_password_hash = tokio::task::spawn_blocking(move || {
            engine.hash(&SecretString::from(DUMMY_PASSWORD.to_owned()))
        })
        .await
        .map_err(|_| AuthError::Infrastructure)?
        .map_err(|_| AuthError::Infrastructure)?;
        Ok(Self {
            repository,
            clock,
            password_engine,
            dummy_password_hash,
            session_ttl,
        })
    }

    pub async fn register(&self, command: RegisterCommand) -> Result<AuthOutcome, AuthError> {
        let email = NormalizedEmail::parse(&command.email).map_err(map_identity_error)?;
        let display_name = DisplayName::parse(&command.display_name).map_err(map_identity_error)?;
        validate_password(command.password.expose_secret()).map_err(map_identity_error)?;

        let password_hash = self.hash_password(command.password).await?;
        let now = self.clock.now();
        let user_id = Uuid::new_v4();
        let user = NewUser {
            id: user_id,
            email,
            display_name,
            password_hash,
            created_at: now,
        };
        let organization = new_personal_organization(&user, now)?;
        let (session, credentials) = self.new_session(user_id, now)?;

        self.repository
            .create_user_with_session(user.clone(), organization, session.clone())
            .await
            .map_err(map_repository_error)?;

        Ok(AuthOutcome {
            user: profile_from_new_user(&user),
            session_id: session.id,
            credentials,
            expires_at: session.expires_at,
        })
    }

    pub async fn login(&self, command: LoginCommand) -> Result<AuthOutcome, AuthError> {
        if command.password.expose_secret().len() > 1_024 {
            return Err(AuthError::InvalidCredentials);
        }
        let email =
            NormalizedEmail::parse(&command.email).map_err(|_| AuthError::InvalidCredentials)?;
        let user = self
            .repository
            .find_user_by_email(&email)
            .await
            .map_err(map_repository_error)?;

        let expected_hash = user.as_ref().map_or_else(
            || self.dummy_password_hash.clone(),
            |user| user.password_hash.clone(),
        );
        let password_valid = self
            .verify_password(command.password, expected_hash)
            .await?;
        let Some(user) = user else {
            return Err(AuthError::InvalidCredentials);
        };
        if !password_valid {
            return Err(AuthError::InvalidCredentials);
        }
        if user.disabled_at.is_some() {
            return Err(AuthError::AccountDisabled);
        }

        let now = self.clock.now();
        let (session, credentials) = self.new_session(user.id, now)?;
        self.repository
            .create_session(session.clone())
            .await
            .map_err(map_repository_error)?;
        Ok(AuthOutcome {
            user: profile_from_stored_user(&user),
            session_id: session.id,
            credentials,
            expires_at: session.expires_at,
        })
    }

    pub async fn authenticate(&self, token: &str) -> Result<ResolvedSession, AuthError> {
        let session = self
            .repository
            .resolve_session(digest_token(token), self.clock.now())
            .await
            .map_err(map_repository_error)?
            .ok_or(AuthError::Unauthenticated)?;
        if session.user.disabled_at.is_some() {
            return Err(AuthError::Unauthenticated);
        }
        Ok(session)
    }

    pub fn verify_csrf(
        &self,
        session: &ResolvedSession,
        csrf_token: &str,
    ) -> Result<(), AuthError> {
        if verify_token_digest(csrf_token, session.csrf_digest) {
            Ok(())
        } else {
            Err(AuthError::InvalidCsrfToken)
        }
    }

    pub async fn logout(&self, token: &str) -> Result<(), AuthError> {
        self.repository
            .revoke_session(digest_token(token), self.clock.now())
            .await
            .map_err(map_repository_error)
    }

    fn new_session(
        &self,
        user_id: Uuid,
        now: OffsetDateTime,
    ) -> Result<(NewSession, SessionCredentials), AuthError> {
        let credentials = SessionCredentials::generate().map_err(|_| AuthError::Infrastructure)?;
        let session = NewSession {
            id: Uuid::new_v4(),
            user_id,
            token_digest: credentials.session_digest(),
            csrf_digest: credentials.csrf_digest(),
            expires_at: now + self.session_ttl,
            created_at: now,
        };
        Ok((session, credentials))
    }

    async fn hash_password(
        &self,
        password: SecretString,
    ) -> Result<EncodedPasswordHash, AuthError> {
        let engine = self.password_engine.clone();
        tokio::task::spawn_blocking(move || engine.hash(&password))
            .await
            .map_err(|_| AuthError::Infrastructure)?
            .map_err(|_| AuthError::Infrastructure)
    }

    async fn verify_password(
        &self,
        password: SecretString,
        expected_hash: EncodedPasswordHash,
    ) -> Result<bool, AuthError> {
        let engine = self.password_engine.clone();
        tokio::task::spawn_blocking(move || engine.verify(&password, &expected_hash))
            .await
            .map_err(|_| AuthError::Infrastructure)?
            .map_err(|_| AuthError::Infrastructure)
    }
}

fn new_personal_organization(
    user: &NewUser,
    now: OffsetDateTime,
) -> Result<NewPersonalOrganization, AuthError> {
    let id = Uuid::new_v4();
    let name = OrganizationName::parse(user.display_name.as_str())
        .map_err(|_| AuthError::Infrastructure)?;
    let slug = OrganizationSlug::parse(format!("org-{}", id.simple()))
        .map_err(|_| AuthError::Infrastructure)?;
    Ok(NewPersonalOrganization {
        id,
        name,
        slug,
        created_at: now,
    })
}

impl ResolvedSession {
    pub fn profile(&self) -> UserProfile {
        profile_from_stored_user(&self.user)
    }
}

fn profile_from_new_user(user: &NewUser) -> UserProfile {
    UserProfile {
        id: user.id,
        email: user.email.as_str().to_owned(),
        display_name: user.display_name.as_str().to_owned(),
    }
}

fn profile_from_stored_user(user: &StoredUser) -> UserProfile {
    UserProfile {
        id: user.id,
        email: user.email.as_str().to_owned(),
        display_name: user.display_name.as_str().to_owned(),
    }
}

fn map_identity_error(error: IdentityValidationError) -> AuthError {
    match error {
        IdentityValidationError::InvalidEmail => AuthError::InvalidEmail,
        IdentityValidationError::InvalidDisplayName => AuthError::InvalidDisplayName,
        IdentityValidationError::InvalidPassword => AuthError::InvalidPassword,
    }
}

fn map_repository_error(error: AuthRepositoryError) -> AuthError {
    match error {
        AuthRepositoryError::DuplicateEmail => AuthError::DuplicateEmail,
        AuthRepositoryError::Unavailable { .. } => AuthError::Infrastructure,
    }
}

use secrecy::ExposeSecret;

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    const NOW: OffsetDateTime = OffsetDateTime::UNIX_EPOCH;

    #[derive(Default)]
    struct RepositoryState {
        users: Vec<StoredUser>,
        organizations: Vec<NewPersonalOrganization>,
        sessions: Vec<NewSession>,
    }

    #[derive(Default)]
    struct InMemoryRepository {
        state: Mutex<RepositoryState>,
    }

    #[async_trait]
    impl AuthRepository for InMemoryRepository {
        async fn create_user_with_session(
            &self,
            user: NewUser,
            organization: NewPersonalOrganization,
            session: NewSession,
        ) -> Result<(), AuthRepositoryError> {
            let mut state = self.state.lock().unwrap();
            if state
                .users
                .iter()
                .any(|existing| existing.email == user.email)
            {
                return Err(AuthRepositoryError::DuplicateEmail);
            }
            state.users.push(StoredUser {
                id: user.id,
                email: user.email,
                display_name: user.display_name,
                password_hash: user.password_hash,
                disabled_at: None,
            });
            state.organizations.push(organization);
            state.sessions.push(session);
            Ok(())
        }

        async fn find_user_by_email(
            &self,
            email: &NormalizedEmail,
        ) -> Result<Option<StoredUser>, AuthRepositoryError> {
            Ok(self
                .state
                .lock()
                .unwrap()
                .users
                .iter()
                .find(|user| &user.email == email)
                .cloned())
        }

        async fn create_session(&self, session: NewSession) -> Result<(), AuthRepositoryError> {
            self.state.lock().unwrap().sessions.push(session);
            Ok(())
        }

        async fn resolve_session(
            &self,
            token_digest: TokenDigest,
            now: OffsetDateTime,
        ) -> Result<Option<ResolvedSession>, AuthRepositoryError> {
            let state = self.state.lock().unwrap();
            let Some(session) = state
                .sessions
                .iter()
                .find(|session| session.token_digest == token_digest && session.expires_at > now)
            else {
                return Ok(None);
            };
            Ok(state
                .users
                .iter()
                .find(|user| user.id == session.user_id)
                .cloned()
                .map(|user| ResolvedSession {
                    session_id: session.id,
                    user,
                    csrf_digest: session.csrf_digest,
                }))
        }

        async fn revoke_session(
            &self,
            token_digest: TokenDigest,
            _revoked_at: OffsetDateTime,
        ) -> Result<(), AuthRepositoryError> {
            self.state
                .lock()
                .unwrap()
                .sessions
                .retain(|session| session.token_digest != token_digest);
            Ok(())
        }
    }

    struct FixedClock;

    impl Clock for FixedClock {
        fn now(&self) -> OffsetDateTime {
            NOW
        }
    }

    async fn service(repository: Arc<InMemoryRepository>) -> AuthService {
        AuthService::with_clock(repository, Arc::new(FixedClock), DEFAULT_SESSION_TTL)
            .await
            .unwrap()
    }

    fn register_command(email: &str) -> RegisterCommand {
        RegisterCommand {
            email: email.to_owned(),
            display_name: "Owner".to_owned(),
            password: SecretString::from("correct horse battery staple".to_owned()),
        }
    }

    #[tokio::test]
    async fn registration_atomically_creates_user_and_session() {
        let repository = Arc::new(InMemoryRepository::default());
        let service = service(repository.clone()).await;
        let result = service
            .register(register_command(" OWNER@EXAMPLE.COM "))
            .await
            .unwrap();

        assert_eq!(result.user.email, "owner@example.com");
        assert_eq!(result.expires_at, NOW + DEFAULT_SESSION_TTL);
        let state = repository.state.lock().unwrap();
        assert_eq!(state.users.len(), 1);
        assert_eq!(state.organizations.len(), 1);
        assert_eq!(state.organizations[0].name.as_str(), "Owner");
        assert!(state.organizations[0].slug.as_str().starts_with("org-"));
        assert_eq!(state.sessions.len(), 1);
        assert_ne!(
            state.sessions[0].token_digest.as_bytes(),
            result
                .credentials
                .session_token()
                .expose_secret()
                .as_bytes(),
        );
    }

    #[tokio::test]
    async fn registration_reports_duplicate_email_with_stable_code() {
        let repository = Arc::new(InMemoryRepository::default());
        let service = service(repository).await;
        service
            .register(register_command("owner@example.com"))
            .await
            .unwrap();
        let error = service
            .register(register_command("OWNER@example.com"))
            .await
            .unwrap_err();
        assert_eq!(error, AuthError::DuplicateEmail);
        assert_eq!(error.code(), "DUPLICATE_EMAIL");
    }

    #[tokio::test]
    async fn login_uses_the_same_error_for_missing_users_and_wrong_passwords() {
        let repository = Arc::new(InMemoryRepository::default());
        let service = service(repository).await;
        service
            .register(register_command("owner@example.com"))
            .await
            .unwrap();

        for email in ["missing@example.com", "owner@example.com"] {
            let error = service
                .login(LoginCommand {
                    email: email.to_owned(),
                    password: SecretString::from("this password is incorrect".to_owned()),
                })
                .await
                .unwrap_err();
            assert_eq!(error, AuthError::InvalidCredentials);
        }
    }

    #[tokio::test]
    async fn authenticates_csrf_and_revokes_sessions() {
        let repository = Arc::new(InMemoryRepository::default());
        let service = service(repository).await;
        let outcome = service
            .register(register_command("owner@example.com"))
            .await
            .unwrap();
        let token = outcome.credentials.session_token().expose_secret();
        let session = service.authenticate(token).await.unwrap();

        assert_eq!(session.profile(), outcome.user);
        assert!(
            service
                .verify_csrf(&session, outcome.credentials.csrf_token().expose_secret(),)
                .is_ok(),
        );
        assert_eq!(
            service.verify_csrf(&session, "incorrect csrf token"),
            Err(AuthError::InvalidCsrfToken),
        );
        service.logout(token).await.unwrap();
        assert!(matches!(
            service.authenticate(token).await,
            Err(AuthError::Unauthenticated),
        ));
    }
}
