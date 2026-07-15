use crate::model::{Member, RemoveMember, UpdateMemberRole};
use async_trait::async_trait;
use std::error::Error as StdError;
use thiserror::Error;
use time::OffsetDateTime;
use uuid::Uuid;

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

    async fn remove_member(&self, removal: RemoveMember) -> Result<(), MembersRepositoryError>;
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
