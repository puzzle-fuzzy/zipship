use crate::model::{BeginReceiveResult, FinalizeResult, NewUpload, UploadRecord};
use async_trait::async_trait;
use std::error::Error as StdError;
use thiserror::Error;
use time::OffsetDateTime;
use uuid::Uuid;
use zipship_domain::MemberRole;

#[derive(Debug, Error)]
pub enum UploadsRepositoryError {
    #[error("operation is forbidden")]
    Forbidden,
    #[error("upload was not found")]
    NotFound,
    #[error("upload state does not permit this operation")]
    StateConflict,
    #[error("upload has expired")]
    Expired,
    #[error("upload byte count is invalid")]
    SizeMismatch,
    #[error("uploads repository is unavailable")]
    Unavailable {
        #[source]
        source: Box<dyn StdError + Send + Sync>,
    },
}

impl UploadsRepositoryError {
    pub fn unavailable(source: impl StdError + Send + Sync + 'static) -> Self {
        Self::Unavailable {
            source: Box::new(source),
        }
    }
}

#[async_trait]
pub trait UploadsRepository: Send + Sync + 'static {
    async fn project_role(
        &self,
        project_id: Uuid,
        actor_id: Uuid,
    ) -> Result<Option<MemberRole>, UploadsRepositoryError>;

    async fn create_upload(
        &self,
        upload: NewUpload,
    ) -> Result<UploadRecord, UploadsRepositoryError>;

    async fn begin_receive(
        &self,
        upload_id: Uuid,
        actor_id: Uuid,
        transfer_id: Uuid,
        now: OffsetDateTime,
        lease_expires_at: OffsetDateTime,
    ) -> Result<BeginReceiveResult, UploadsRepositoryError>;

    async fn mark_uploaded(
        &self,
        upload_id: Uuid,
        actor_id: Uuid,
        transfer_id: Uuid,
        received_size: u64,
        now: OffsetDateTime,
    ) -> Result<UploadRecord, UploadsRepositoryError>;

    async fn requeue_receive(
        &self,
        upload_id: Uuid,
        actor_id: Uuid,
        transfer_id: Uuid,
        error_code: &'static str,
        now: OffsetDateTime,
    ) -> Result<(), UploadsRepositoryError>;

    async fn finalize_upload(
        &self,
        upload_id: Uuid,
        actor_id: Uuid,
        now: OffsetDateTime,
    ) -> Result<FinalizeResult, UploadsRepositoryError>;

    async fn find_upload_for_member(
        &self,
        upload_id: Uuid,
        actor_id: Uuid,
    ) -> Result<Option<UploadRecord>, UploadsRepositoryError>;
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
