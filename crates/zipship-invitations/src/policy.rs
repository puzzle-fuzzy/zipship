use thiserror::Error;
use zipship_domain::{MemberRole, PermissionAction};

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
