use crate::error::InvitationsError;
use secrecy::SecretString;
use std::str::FromStr;
use time::OffsetDateTime;
use uuid::Uuid;
use zipship_auth::{NormalizedEmail, TokenDigest};
use zipship_domain::MemberRole;

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
