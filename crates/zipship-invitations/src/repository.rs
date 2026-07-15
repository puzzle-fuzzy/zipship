use crate::model::{
    AcceptInvitation, AcceptedInvitation, Invitation, ListInvitations, NewInvitation,
    RevokeInvitation,
};
use async_trait::async_trait;
use std::error::Error as StdError;
use thiserror::Error;
use time::OffsetDateTime;

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
