use super::*;

#[derive(Default)]
struct AuthState {
    users: Vec<StoredUser>,
    sessions: Vec<NewSession>,
}

#[derive(Default)]
pub(super) struct TestAuthRepository {
    state: Mutex<AuthState>,
}

#[async_trait]
impl AuthRepository for TestAuthRepository {
    async fn create_user_with_session(
        &self,
        user: NewUser,
        _organization: NewPersonalOrganization,
        session: NewSession,
    ) -> Result<(), AuthRepositoryError> {
        let mut state = self.state.lock().unwrap();
        if state.users.iter().any(|stored| stored.email == user.email) {
            return Err(AuthRepositoryError::DuplicateEmail);
        }
        state.users.push(stored_user(user));
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
        display_name: zipship_auth::DisplayName,
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

fn stored_user(user: NewUser) -> StoredUser {
    StoredUser {
        id: user.id,
        email: user.email,
        display_name: user.display_name,
        password_hash: user.password_hash,
        disabled_at: None,
    }
}
