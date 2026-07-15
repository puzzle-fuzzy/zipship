use crate::{
    error::MembersError,
    model::{Member, RemoveMember, RemoveMemberCommand, UpdateMemberRole, UpdateMemberRoleCommand},
    repository::{Clock, MembersRepository, MembersRepositoryError, SystemClock},
};
use std::{str::FromStr, sync::Arc};
use uuid::Uuid;
use zipship_domain::MemberRole;

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

    pub async fn remove_member(&self, command: RemoveMemberCommand) -> Result<(), MembersError> {
        self.repository
            .remove_member(RemoveMember {
                organization_id: command.organization_id,
                actor_id: command.actor_id,
                target_user_id: command.target_user_id,
                removed_at: self.clock.now(),
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
