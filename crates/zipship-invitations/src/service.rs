use crate::{
    error::InvitationsError,
    model::{
        AcceptInvitation, AcceptInvitationCommand, AcceptedInvitation, CreateInvitationCommand,
        Invitation, IssuedInvitation, ListInvitations, NewInvitation, RevokeInvitation,
        RevokeInvitationCommand,
    },
    repository::{Clock, InvitationsRepository, InvitationsRepositoryError, SystemClock},
};
use std::{str::FromStr, sync::Arc};
use time::Duration;
use uuid::Uuid;
use zipship_auth::{NormalizedEmail, OpaqueToken, digest_valid_opaque_token};
use zipship_domain::MemberRole;

const DEFAULT_INVITATION_TTL: Duration = Duration::days(7);

#[derive(Clone)]
pub struct InvitationsService {
    repository: Arc<dyn InvitationsRepository>,
    clock: Arc<dyn Clock>,
    ttl: Duration,
}

impl InvitationsService {
    pub fn new(repository: Arc<dyn InvitationsRepository>) -> Self {
        Self::with_clock_and_ttl(repository, Arc::new(SystemClock), DEFAULT_INVITATION_TTL)
    }

    pub fn with_clock_and_ttl(
        repository: Arc<dyn InvitationsRepository>,
        clock: Arc<dyn Clock>,
        ttl: Duration,
    ) -> Self {
        assert!(ttl.is_positive(), "invitation TTL must be positive");
        Self {
            repository,
            clock,
            ttl,
        }
    }

    pub async fn create(
        &self,
        command: CreateInvitationCommand,
    ) -> Result<IssuedInvitation, InvitationsError> {
        let email =
            NormalizedEmail::parse(&command.email).map_err(|_| InvitationsError::InvalidEmail)?;
        let role =
            MemberRole::from_str(&command.role).map_err(|_| InvitationsError::InvalidRole)?;
        let created_at = self.clock.now();
        let expires_at = created_at
            .checked_add(self.ttl)
            .ok_or(InvitationsError::Infrastructure)?;
        let token = OpaqueToken::generate().map_err(|_| InvitationsError::Infrastructure)?;
        let invitation = self
            .repository
            .create_invitation(NewInvitation {
                id: Uuid::new_v4(),
                organization_id: command.organization_id,
                email,
                role,
                invited_by: command.actor_id,
                token_digest: token.digest(),
                created_at,
                expires_at,
            })
            .await
            .map_err(map_repository_error)?;
        Ok(IssuedInvitation {
            invitation,
            accept_token: token.into_secret(),
        })
    }

    pub async fn list(
        &self,
        actor_id: Uuid,
        organization_id: Uuid,
    ) -> Result<Vec<Invitation>, InvitationsError> {
        self.repository
            .list_invitations(ListInvitations {
                organization_id,
                actor_id,
                now: self.clock.now(),
            })
            .await
            .map_err(map_repository_error)
    }

    pub async fn revoke(&self, command: RevokeInvitationCommand) -> Result<(), InvitationsError> {
        self.repository
            .revoke_invitation(RevokeInvitation {
                organization_id: command.organization_id,
                actor_id: command.actor_id,
                invitation_id: command.invitation_id,
                revoked_at: self.clock.now(),
            })
            .await
            .map_err(map_repository_error)
    }

    pub async fn accept(
        &self,
        command: AcceptInvitationCommand,
    ) -> Result<AcceptedInvitation, InvitationsError> {
        let actor_email = NormalizedEmail::parse(&command.actor_email)
            .map_err(|_| InvitationsError::Infrastructure)?;
        let token_digest =
            digest_valid_opaque_token(&command.token).ok_or(InvitationsError::NotFound)?;
        self.repository
            .accept_invitation(AcceptInvitation {
                actor_id: command.actor_id,
                actor_email,
                token_digest,
                accepted_at: self.clock.now(),
            })
            .await
            .map_err(map_repository_error)
    }
}

fn map_repository_error(error: InvitationsRepositoryError) -> InvitationsError {
    match error {
        InvitationsRepositoryError::Forbidden => InvitationsError::Forbidden,
        InvitationsRepositoryError::AlreadyMember => InvitationsError::AlreadyMember,
        InvitationsRepositoryError::Pending => InvitationsError::Pending,
        InvitationsRepositoryError::NotFound => InvitationsError::NotFound,
        InvitationsRepositoryError::Expired => InvitationsError::Expired,
        InvitationsRepositoryError::WrongRecipient => InvitationsError::WrongRecipient,
        InvitationsRepositoryError::Unavailable { .. } => InvitationsError::Infrastructure,
    }
}
