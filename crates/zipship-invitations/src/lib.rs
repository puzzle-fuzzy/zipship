#![forbid(unsafe_code)]

use async_trait::async_trait;
use secrecy::SecretString;
use std::{error::Error as StdError, str::FromStr, sync::Arc};
use thiserror::Error;
use time::{Duration, OffsetDateTime};
use uuid::Uuid;
use zipship_auth::{NormalizedEmail, OpaqueToken, TokenDigest, digest_valid_opaque_token};
use zipship_domain::{MemberRole, PermissionAction};

const DEFAULT_INVITATION_TTL: Duration = Duration::days(7);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InvitationState {
    Pending,
    Accepted,
    Revoked,
    Expired,
}

impl InvitationState {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Accepted => "accepted",
            Self::Revoked => "revoked",
            Self::Expired => "expired",
        }
    }
}

impl FromStr for InvitationState {
    type Err = InvitationsError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "pending" => Ok(Self::Pending),
            "accepted" => Ok(Self::Accepted),
            "revoked" => Ok(Self::Revoked),
            "expired" => Ok(Self::Expired),
            _ => Err(InvitationsError::Infrastructure),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Invitation {
    pub id: Uuid,
    pub organization_id: Uuid,
    pub email: String,
    pub role: MemberRole,
    pub state: InvitationState,
    pub invited_by: Option<Uuid>,
    pub accepted_by: Option<Uuid>,
    pub created_at: OffsetDateTime,
    pub expires_at: OffsetDateTime,
    pub resolved_at: Option<OffsetDateTime>,
}

#[derive(Debug, Clone)]
pub struct NewInvitation {
    pub id: Uuid,
    pub organization_id: Uuid,
    pub email: NormalizedEmail,
    pub role: MemberRole,
    pub invited_by: Uuid,
    pub token_digest: TokenDigest,
    pub created_at: OffsetDateTime,
    pub expires_at: OffsetDateTime,
}

#[derive(Debug)]
pub struct IssuedInvitation {
    pub invitation: Invitation,
    pub accept_token: SecretString,
}

#[derive(Debug)]
pub struct CreateInvitationCommand {
    pub organization_id: Uuid,
    pub actor_id: Uuid,
    pub email: String,
    pub role: String,
}

#[derive(Debug)]
pub struct ListInvitations {
    pub organization_id: Uuid,
    pub actor_id: Uuid,
    pub now: OffsetDateTime,
}

#[derive(Debug)]
pub struct RevokeInvitation {
    pub organization_id: Uuid,
    pub actor_id: Uuid,
    pub invitation_id: Uuid,
    pub revoked_at: OffsetDateTime,
}

#[derive(Debug)]
pub struct RevokeInvitationCommand {
    pub organization_id: Uuid,
    pub actor_id: Uuid,
    pub invitation_id: Uuid,
}

#[derive(Debug)]
pub struct AcceptInvitation {
    pub actor_id: Uuid,
    pub actor_email: NormalizedEmail,
    pub token_digest: TokenDigest,
    pub accepted_at: OffsetDateTime,
}

#[derive(Debug)]
pub struct AcceptInvitationCommand {
    pub actor_id: Uuid,
    pub actor_email: String,
    pub token: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AcceptedInvitation {
    pub invitation_id: Uuid,
    pub organization_id: Uuid,
    pub user_id: Uuid,
    pub role: MemberRole,
    pub replayed: bool,
}

#[derive(Debug, Error, Clone, Copy, PartialEq, Eq)]
pub enum InvitationPolicyError {
    #[error("the actor cannot manage this invitation role")]
    Forbidden,
}

pub fn validate_invitation_management(
    actor_role: MemberRole,
    invitation_role: MemberRole,
) -> Result<(), InvitationPolicyError> {
    if !actor_role.can(PermissionAction::InviteMember)
        || (actor_role != MemberRole::Owner && invitation_role == MemberRole::Owner)
    {
        return Err(InvitationPolicyError::Forbidden);
    }
    Ok(())
}

#[derive(Debug, Error)]
pub enum InvitationsRepositoryError {
    #[error("operation is forbidden")]
    Forbidden,
    #[error("the email already belongs to an organization member")]
    AlreadyMember,
    #[error("an active invitation already exists")]
    Pending,
    #[error("invitation was not found")]
    NotFound,
    #[error("invitation has expired")]
    Expired,
    #[error("invitation belongs to another email address")]
    WrongRecipient,
    #[error("invitations repository is unavailable")]
    Unavailable {
        #[source]
        source: Box<dyn StdError + Send + Sync>,
    },
}

impl InvitationsRepositoryError {
    pub fn unavailable(source: impl StdError + Send + Sync + 'static) -> Self {
        Self::Unavailable {
            source: Box::new(source),
        }
    }
}

#[async_trait]
pub trait InvitationsRepository: Send + Sync + 'static {
    async fn create_invitation(
        &self,
        invitation: NewInvitation,
    ) -> Result<Invitation, InvitationsRepositoryError>;

    async fn list_invitations(
        &self,
        request: ListInvitations,
    ) -> Result<Vec<Invitation>, InvitationsRepositoryError>;

    async fn revoke_invitation(
        &self,
        request: RevokeInvitation,
    ) -> Result<(), InvitationsRepositoryError>;

    async fn accept_invitation(
        &self,
        request: AcceptInvitation,
    ) -> Result<AcceptedInvitation, InvitationsRepositoryError>;
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
pub enum InvitationsError {
    #[error("invitation email is invalid")]
    InvalidEmail,
    #[error("invitation role is invalid")]
    InvalidRole,
    #[error("operation is forbidden")]
    Forbidden,
    #[error("the email already belongs to an organization member")]
    AlreadyMember,
    #[error("an active invitation already exists")]
    Pending,
    #[error("invitation was not found")]
    NotFound,
    #[error("invitation has expired")]
    Expired,
    #[error("invitation belongs to another email address")]
    WrongRecipient,
    #[error("invitations infrastructure failed")]
    Infrastructure,
}

impl InvitationsError {
    pub const fn code(self) -> &'static str {
        match self {
            Self::InvalidEmail => "INVALID_EMAIL",
            Self::InvalidRole => "INVALID_MEMBER_ROLE",
            Self::Forbidden => "FORBIDDEN",
            Self::AlreadyMember => "ALREADY_MEMBER",
            Self::Pending => "INVITATION_PENDING",
            Self::NotFound => "INVITATION_NOT_FOUND",
            Self::Expired => "INVITATION_EXPIRED",
            Self::WrongRecipient => "INVITATION_WRONG_RECIPIENT",
            Self::Infrastructure => "INVITATIONS_INFRASTRUCTURE_FAILURE",
        }
    }
}

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

#[cfg(test)]
mod tests;
