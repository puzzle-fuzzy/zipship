#![forbid(unsafe_code)]

use async_trait::async_trait;
use std::{error::Error as StdError, str::FromStr, sync::Arc};
use thiserror::Error;
use time::OffsetDateTime;
use uuid::Uuid;
use zipship_domain::{MemberRole, PermissionAction};

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

#[derive(Debug, Error)]
pub enum MembersRepositoryError {
    #[error("operation is forbidden")]
    Forbidden,
    #[error("member was not found")]
    NotFound,
    #[error("an organization must retain at least one owner")]
    LastOwner,
    #[error("members repository is unavailable")]
    Unavailable {
        #[source]
        source: Box<dyn StdError + Send + Sync>,
    },
}

impl MembersRepositoryError {
    pub fn unavailable(source: impl StdError + Send + Sync + 'static) -> Self {
        Self::Unavailable {
            source: Box::new(source),
        }
    }
}

#[async_trait]
pub trait MembersRepository: Send + Sync + 'static {
    async fn list_members(
        &self,
        organization_id: Uuid,
        actor_id: Uuid,
    ) -> Result<Vec<Member>, MembersRepositoryError>;

    async fn update_role(&self, update: UpdateMemberRole)
    -> Result<Member, MembersRepositoryError>;
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
pub enum MembersError {
    #[error("member role is invalid")]
    InvalidRole,
    #[error("operation is forbidden")]
    Forbidden,
    #[error("member was not found")]
    NotFound,
    #[error("an organization must retain at least one owner")]
    LastOwner,
    #[error("members infrastructure failed")]
    Infrastructure,
}

impl MembersError {
    pub const fn code(self) -> &'static str {
        match self {
            Self::InvalidRole => "INVALID_MEMBER_ROLE",
            Self::Forbidden => "FORBIDDEN",
            Self::NotFound => "MEMBER_NOT_FOUND",
            Self::LastOwner => "LAST_OWNER",
            Self::Infrastructure => "MEMBERS_INFRASTRUCTURE_FAILURE",
        }
    }
}

#[derive(Clone)]
pub struct MembersService {
    repository: Arc<dyn MembersRepository>,
    clock: Arc<dyn Clock>,
}

impl MembersService {
    pub fn new(repository: Arc<dyn MembersRepository>) -> Self {
        Self::with_clock(repository, Arc::new(SystemClock))
    }

    pub fn with_clock(repository: Arc<dyn MembersRepository>, clock: Arc<dyn Clock>) -> Self {
        Self { repository, clock }
    }

    pub async fn list_members(
        &self,
        actor_id: Uuid,
        organization_id: Uuid,
    ) -> Result<Vec<Member>, MembersError> {
        self.repository
            .list_members(organization_id, actor_id)
            .await
            .map_err(map_repository_error)
    }

    pub async fn update_role(
        &self,
        command: UpdateMemberRoleCommand,
    ) -> Result<Member, MembersError> {
        let role = MemberRole::from_str(&command.role).map_err(|_| MembersError::InvalidRole)?;
        self.repository
            .update_role(UpdateMemberRole {
                organization_id: command.organization_id,
                actor_id: command.actor_id,
                target_user_id: command.target_user_id,
                role,
                updated_at: self.clock.now(),
            })
            .await
            .map_err(map_repository_error)
    }
}

fn map_repository_error(error: MembersRepositoryError) -> MembersError {
    match error {
        MembersRepositoryError::Forbidden => MembersError::Forbidden,
        MembersRepositoryError::NotFound => MembersError::NotFound,
        MembersRepositoryError::LastOwner => MembersError::LastOwner,
        MembersRepositoryError::Unavailable { .. } => MembersError::Infrastructure,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    const NOW: OffsetDateTime = OffsetDateTime::UNIX_EPOCH;

    #[derive(Default)]
    struct TestRepository {
        updates: Mutex<Vec<UpdateMemberRole>>,
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
            validate_role_change(MemberRole::Owner, MemberRole::Admin, MemberRole::Owner, 1,)
                .is_ok()
        );
    }

    #[test]
    fn protects_the_last_owner() {
        assert_eq!(
            validate_role_change(MemberRole::Owner, MemberRole::Owner, MemberRole::Admin, 1,),
            Err(RoleChangePolicyError::LastOwner)
        );
        assert!(
            validate_role_change(MemberRole::Owner, MemberRole::Owner, MemberRole::Admin, 2,)
                .is_ok()
        );
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
}
