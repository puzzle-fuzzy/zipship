use super::*;
use async_trait::async_trait;
use std::sync::{Arc, Mutex};
use time::OffsetDateTime;
use uuid::Uuid;
use zipship_domain::MemberRole;

const NOW: OffsetDateTime = OffsetDateTime::UNIX_EPOCH;

#[derive(Default)]
struct TestRepository {
    updates: Mutex<Vec<UpdateMemberRole>>,
    removals: Mutex<Vec<RemoveMember>>,
}

#[async_trait]
impl MembersRepository for TestRepository {
    async fn list_members(
        &self,
        _organization_id: Uuid,
        _actor_id: Uuid,
    ) -> Result<Vec<Member>, MembersRepositoryError> {
        Ok(Vec::new())
    }

    async fn update_role(
        &self,
        update: UpdateMemberRole,
    ) -> Result<Member, MembersRepositoryError> {
        let member = Member {
            user_id: update.target_user_id,
            email: "member@example.com".to_owned(),
            display_name: "Member".to_owned(),
            role: update.role,
            joined_at: NOW,
        };
        self.updates.lock().unwrap().push(update);
        Ok(member)
    }

    async fn remove_member(&self, removal: RemoveMember) -> Result<(), MembersRepositoryError> {
        self.removals.lock().unwrap().push(removal);
        Ok(())
    }
}

struct FixedClock;

impl Clock for FixedClock {
    fn now(&self) -> OffsetDateTime {
        NOW
    }
}

#[test]
fn enforces_owner_and_administrator_role_boundaries() {
    assert_eq!(
        validate_role_change(MemberRole::Admin, MemberRole::Viewer, MemberRole::Owner, 1,),
        Err(RoleChangePolicyError::Forbidden)
    );
    assert_eq!(
        validate_role_change(MemberRole::Admin, MemberRole::Owner, MemberRole::Viewer, 2,),
        Err(RoleChangePolicyError::Forbidden)
    );
    assert!(
        validate_role_change(
            MemberRole::Admin,
            MemberRole::Developer,
            MemberRole::Deployer,
            1,
        )
        .is_ok()
    );
    assert!(
        validate_role_change(MemberRole::Owner, MemberRole::Admin, MemberRole::Owner, 1,).is_ok()
    );
}

#[test]
fn protects_the_last_owner() {
    assert_eq!(
        validate_role_change(MemberRole::Owner, MemberRole::Owner, MemberRole::Admin, 1,),
        Err(RoleChangePolicyError::LastOwner)
    );
    assert!(
        validate_role_change(MemberRole::Owner, MemberRole::Owner, MemberRole::Admin, 2,).is_ok()
    );
}

#[test]
fn enforces_member_removal_boundaries() {
    assert!(validate_member_removal(true, MemberRole::Viewer, MemberRole::Viewer, 1).is_ok());
    assert_eq!(
        validate_member_removal(true, MemberRole::Owner, MemberRole::Owner, 1),
        Err(RoleChangePolicyError::LastOwner)
    );
    assert!(validate_member_removal(true, MemberRole::Owner, MemberRole::Owner, 2).is_ok());
    assert_eq!(
        validate_member_removal(false, MemberRole::Viewer, MemberRole::Developer, 1),
        Err(RoleChangePolicyError::Forbidden)
    );
    assert_eq!(
        validate_member_removal(false, MemberRole::Admin, MemberRole::Owner, 2),
        Err(RoleChangePolicyError::Forbidden)
    );
    assert!(validate_member_removal(false, MemberRole::Admin, MemberRole::Developer, 1).is_ok());
    assert!(validate_member_removal(false, MemberRole::Owner, MemberRole::Owner, 2).is_ok());
}

#[tokio::test]
async fn validates_and_forwards_typed_role_updates() {
    let repository = Arc::new(TestRepository::default());
    let service = MembersService::with_clock(repository.clone(), Arc::new(FixedClock));
    let actor_id = Uuid::new_v4();
    let target_user_id = Uuid::new_v4();
    let organization_id = Uuid::new_v4();

    let member = service
        .update_role(UpdateMemberRoleCommand {
            organization_id,
            actor_id,
            target_user_id,
            role: "developer".to_owned(),
        })
        .await
        .unwrap();

    assert_eq!(member.role, MemberRole::Developer);
    let updates = repository.updates.lock().unwrap();
    assert_eq!(updates.len(), 1);
    assert_eq!(updates[0].updated_at, NOW);
    assert_eq!(updates[0].actor_id, actor_id);
}

#[tokio::test]
async fn rejects_invalid_roles_before_repository_access() {
    let repository = Arc::new(TestRepository::default());
    let service = MembersService::with_clock(repository.clone(), Arc::new(FixedClock));
    let error = service
        .update_role(UpdateMemberRoleCommand {
            organization_id: Uuid::new_v4(),
            actor_id: Uuid::new_v4(),
            target_user_id: Uuid::new_v4(),
            role: "superuser".to_owned(),
        })
        .await
        .unwrap_err();

    assert_eq!(error, MembersError::InvalidRole);
    assert_eq!(error.code(), "INVALID_MEMBER_ROLE");
    assert!(repository.updates.lock().unwrap().is_empty());
}

#[tokio::test]
async fn forwards_member_removals_with_a_stable_timestamp() {
    let repository = Arc::new(TestRepository::default());
    let service = MembersService::with_clock(repository.clone(), Arc::new(FixedClock));
    let actor_id = Uuid::new_v4();
    let target_user_id = Uuid::new_v4();
    let organization_id = Uuid::new_v4();

    service
        .remove_member(RemoveMemberCommand {
            organization_id,
            actor_id,
            target_user_id,
        })
        .await
        .unwrap();

    let removals = repository.removals.lock().unwrap();
    assert_eq!(removals.len(), 1);
    assert_eq!(removals[0].organization_id, organization_id);
    assert_eq!(removals[0].actor_id, actor_id);
    assert_eq!(removals[0].target_user_id, target_user_id);
    assert_eq!(removals[0].removed_at, NOW);
}
