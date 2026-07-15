use super::implementation::DEFAULT_SESSION_TTL;
use super::*;
use crate::{DisplayName, NormalizedEmail, TokenDigest};
use async_trait::async_trait;
use secrecy::{ExposeSecret, SecretString};
use std::sync::{Arc, Mutex};
use time::OffsetDateTime;
use uuid::Uuid;

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

    async fn update_display_name(
        &self,
        user_id: Uuid,
        display_name: DisplayName,
        _updated_at: OffsetDateTime,
    ) -> Result<StoredUser, AuthRepositoryError> {
        let mut state = self.state.lock().unwrap();
        let user = state
            .users
            .iter_mut()
            .find(|user| user.id == user_id)
            .ok_or(AuthRepositoryError::UserNotFound)?;
        user.display_name = display_name;
        Ok(user.clone())
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

#[tokio::test]
async fn updates_and_normalizes_the_current_users_display_name() {
    let repository = Arc::new(InMemoryRepository::default());
    let service = service(repository.clone()).await;
    let outcome = service
        .register(register_command("owner@example.com"))
        .await
        .unwrap();
    let session = service
        .authenticate(outcome.credentials.session_token().expose_secret())
        .await
        .unwrap();

    let profile = service
        .update_profile(&session, "  Product Owner  ".to_owned())
        .await
        .unwrap();

    assert_eq!(profile.display_name, "Product Owner");
    assert_eq!(profile.email, "owner@example.com");
    assert_eq!(
        repository.state.lock().unwrap().users[0]
            .display_name
            .as_str(),
        "Product Owner"
    );
}

#[tokio::test]
async fn rejects_invalid_display_name_updates_without_mutating_the_user() {
    let repository = Arc::new(InMemoryRepository::default());
    let service = service(repository.clone()).await;
    let outcome = service
        .register(register_command("owner@example.com"))
        .await
        .unwrap();
    let session = service
        .authenticate(outcome.credentials.session_token().expose_secret())
        .await
        .unwrap();

    let error = service
        .update_profile(&session, "   ".to_owned())
        .await
        .unwrap_err();

    assert_eq!(error, AuthError::InvalidDisplayName);
    assert_eq!(error.code(), "INVALID_DISPLAY_NAME");
    assert_eq!(
        repository.state.lock().unwrap().users[0]
            .display_name
            .as_str(),
        "Owner"
    );
}
