use super::*;

struct Probe {
    status: CheckStatus,
    _storage_root: tempfile::TempDir,
}

#[async_trait]
impl ReadinessProbe for Probe {
    async fn check(&self) -> BTreeMap<String, CheckStatus> {
        BTreeMap::from([("database".to_owned(), self.status.clone())])
    }
}

#[derive(Default)]
struct AuthState {
    users: Vec<StoredUser>,
    sessions: Vec<NewSession>,
}

#[derive(Default)]
struct TestAuthRepository {
    state: Mutex<AuthState>,
}

mod projects;
use projects::TestProjectsRepository;

struct TestMembersRepository;

#[derive(Default)]
struct TestInvitationsRepository {
    invitations: Mutex<Vec<(Invitation, TokenDigest)>>,
}

mod tokens;
use tokens::TestApiTokensRepository;

mod recovery;
use recovery::TestRecoveryRepository;

mod uploads;
use uploads::TestUploadsRepository;

mod release_operations;
use release_operations::{TestAuditRepository, TestDeploymentsRepository, TestReleasesRepository};

#[async_trait]
impl MembersRepository for TestMembersRepository {
    async fn list_members(
        &self,
        organization_id: Uuid,
        actor_id: Uuid,
    ) -> Result<Vec<Member>, MembersRepositoryError> {
        if organization_id != TEST_ORGANIZATION_ID {
            return Err(MembersRepositoryError::Forbidden);
        }
        Ok(vec![Member {
            user_id: actor_id,
            email: "owner@example.com".to_owned(),
            display_name: "Owner".to_owned(),
            role: MemberRole::Owner,
            joined_at: OffsetDateTime::UNIX_EPOCH,
        }])
    }

    async fn update_role(
        &self,
        update: UpdateMemberRole,
    ) -> Result<Member, MembersRepositoryError> {
        if update.organization_id != TEST_ORGANIZATION_ID {
            return Err(MembersRepositoryError::Forbidden);
        }
        if update.target_user_id == update.actor_id && update.role != MemberRole::Owner {
            return Err(MembersRepositoryError::LastOwner);
        }
        Ok(Member {
            user_id: update.target_user_id,
            email: "member@example.com".to_owned(),
            display_name: "Member".to_owned(),
            role: update.role,
            joined_at: OffsetDateTime::UNIX_EPOCH,
        })
    }

    async fn remove_member(&self, removal: RemoveMember) -> Result<(), MembersRepositoryError> {
        if removal.organization_id != TEST_ORGANIZATION_ID {
            return Err(MembersRepositoryError::Forbidden);
        }
        if removal.target_user_id == removal.actor_id {
            return Err(MembersRepositoryError::LastOwner);
        }
        Ok(())
    }
}

#[async_trait]
impl InvitationsRepository for TestInvitationsRepository {
    async fn create_invitation(
        &self,
        invitation: NewInvitation,
    ) -> Result<Invitation, InvitationsRepositoryError> {
        let stored = Invitation {
            id: invitation.id,
            organization_id: invitation.organization_id,
            email: invitation.email.as_str().to_owned(),
            role: invitation.role,
            state: InvitationState::Pending,
            invited_by: Some(invitation.invited_by),
            accepted_by: None,
            created_at: invitation.created_at,
            expires_at: invitation.expires_at,
            resolved_at: None,
        };
        self.invitations
            .lock()
            .unwrap()
            .push((stored.clone(), invitation.token_digest));
        Ok(stored)
    }

    async fn list_invitations(
        &self,
        request: ListInvitations,
    ) -> Result<Vec<Invitation>, InvitationsRepositoryError> {
        if request.organization_id != TEST_ORGANIZATION_ID {
            return Err(InvitationsRepositoryError::Forbidden);
        }
        Ok(self
            .invitations
            .lock()
            .unwrap()
            .iter()
            .map(|(invitation, _)| invitation)
            .filter(|invitation| {
                invitation.state == InvitationState::Pending && invitation.expires_at > request.now
            })
            .cloned()
            .collect())
    }

    async fn revoke_invitation(
        &self,
        request: RevokeInvitation,
    ) -> Result<(), InvitationsRepositoryError> {
        let mut invitations = self.invitations.lock().unwrap();
        let invitation = invitations
            .iter_mut()
            .map(|(invitation, _)| invitation)
            .find(|invitation| {
                invitation.organization_id == request.organization_id
                    && invitation.id == request.invitation_id
                    && invitation.state == InvitationState::Pending
            })
            .ok_or(InvitationsRepositoryError::NotFound)?;
        invitation.state = InvitationState::Revoked;
        invitation.resolved_at = Some(request.revoked_at);
        Ok(())
    }

    async fn accept_invitation(
        &self,
        request: AcceptInvitation,
    ) -> Result<AcceptedInvitation, InvitationsRepositoryError> {
        let mut invitations = self.invitations.lock().unwrap();
        let invitation = invitations
            .iter_mut()
            .find(|(_, digest)| *digest == request.token_digest)
            .map(|(invitation, _)| invitation)
            .ok_or(InvitationsRepositoryError::NotFound)?;
        if invitation.state == InvitationState::Accepted
            && invitation.accepted_by == Some(request.actor_id)
        {
            return Ok(AcceptedInvitation {
                invitation_id: invitation.id,
                organization_id: invitation.organization_id,
                user_id: request.actor_id,
                role: invitation.role,
                replayed: true,
            });
        }
        if invitation.state != InvitationState::Pending {
            return Err(InvitationsRepositoryError::NotFound);
        }
        if invitation.email != request.actor_email.as_str() {
            return Err(InvitationsRepositoryError::WrongRecipient);
        }
        invitation.state = InvitationState::Accepted;
        invitation.accepted_by = Some(request.actor_id);
        invitation.resolved_at = Some(request.accepted_at);
        Ok(AcceptedInvitation {
            invitation_id: invitation.id,
            organization_id: invitation.organization_id,
            user_id: request.actor_id,
            role: invitation.role,
            replayed: false,
        })
    }
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

mod app;
