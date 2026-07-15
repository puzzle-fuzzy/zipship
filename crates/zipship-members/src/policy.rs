use thiserror::Error;
use zipship_domain::{MemberRole, PermissionAction};

#[derive(Debug, Error, Clone, Copy, PartialEq, Eq)]
pub enum RoleChangePolicyError {
    #[error("the actor cannot manage this role")]
    Forbidden,
    #[error("an organization must retain at least one owner")]
    LastOwner,
}

pub fn validate_role_change(
    actor_role: MemberRole,
    target_role: MemberRole,
    desired_role: MemberRole,
    owner_count: u64,
) -> Result<(), RoleChangePolicyError> {
    if !actor_role.can(PermissionAction::ManageMember) {
        return Err(RoleChangePolicyError::Forbidden);
    }
    if actor_role != MemberRole::Owner
        && (target_role == MemberRole::Owner || desired_role == MemberRole::Owner)
    {
        return Err(RoleChangePolicyError::Forbidden);
    }
    if target_role == MemberRole::Owner && desired_role != MemberRole::Owner && owner_count <= 1 {
        return Err(RoleChangePolicyError::LastOwner);
    }
    Ok(())
}

pub fn validate_member_removal(
    is_self_removal: bool,
    actor_role: MemberRole,
    target_role: MemberRole,
    owner_count: u64,
) -> Result<(), RoleChangePolicyError> {
    if !is_self_removal {
        if !actor_role.can(PermissionAction::ManageMember) {
            return Err(RoleChangePolicyError::Forbidden);
        }
        if actor_role != MemberRole::Owner && target_role == MemberRole::Owner {
            return Err(RoleChangePolicyError::Forbidden);
        }
    }
    if target_role == MemberRole::Owner && owner_count <= 1 {
        return Err(RoleChangePolicyError::LastOwner);
    }
    Ok(())
}
