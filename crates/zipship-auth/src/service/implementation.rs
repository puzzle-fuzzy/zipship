use super::{
    error::AuthError,
    model::{
        AuthOutcome, LoginCommand, NewPersonalOrganization, NewSession, NewUser, RegisterCommand,
        ResolvedSession, UserProfile, profile_from_new_user, profile_from_stored_user,
    },
    repository::{AuthRepository, AuthRepositoryError, Clock, SystemClock},
};
use crate::{
    DisplayName, EncodedPasswordHash, IdentityValidationError, NormalizedEmail, PasswordEngine,
    SessionCredentials, digest_token, validate_password, verify_token_digest,
};
use secrecy::{ExposeSecret, SecretString};
use std::sync::Arc;
use time::{Duration, OffsetDateTime};
use uuid::Uuid;
use zipship_domain::{OrganizationName, OrganizationSlug};

pub(super) const DEFAULT_SESSION_TTL: Duration = Duration::days(7);
const DUMMY_PASSWORD: &str = "zipship dummy credential value";

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

    pub async fn update_profile(
        &self,
        session: &ResolvedSession,
        display_name: String,
    ) -> Result<UserProfile, AuthError> {
        let display_name = DisplayName::parse(&display_name).map_err(map_identity_error)?;
        let user = self
            .repository
            .update_display_name(session.user.id, display_name, self.clock.now())
            .await
            .map_err(map_repository_error)?;
        Ok(profile_from_stored_user(&user))
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
        AuthRepositoryError::UserNotFound => AuthError::Unauthenticated,
        AuthRepositoryError::Unavailable { .. } => AuthError::Infrastructure,
    }
}
