use time::OffsetDateTime;
use uuid::Uuid;
use zipship_domain::MemberRole;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Member {
    pub user_id: Uuid,
    pub email: String,
    pub display_name: String,
    pub role: MemberRole,
    pub joined_at: OffsetDateTime,
}

#[derive(Debug)]
pub struct UpdateMemberRole {
    pub organization_id: Uuid,
    pub actor_id: Uuid,
    pub target_user_id: Uuid,
    pub role: MemberRole,
    pub updated_at: OffsetDateTime,
}

#[derive(Debug)]
pub struct UpdateMemberRoleCommand {
    pub organization_id: Uuid,
    pub actor_id: Uuid,
    pub target_user_id: Uuid,
    pub role: String,
}

#[derive(Debug)]
pub struct RemoveMember {
    pub organization_id: Uuid,
    pub actor_id: Uuid,
    pub target_user_id: Uuid,
    pub removed_at: OffsetDateTime,
}

#[derive(Debug)]
pub struct RemoveMemberCommand {
    pub organization_id: Uuid,
    pub actor_id: Uuid,
    pub target_user_id: Uuid,
}
