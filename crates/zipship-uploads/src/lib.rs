#![forbid(unsafe_code)]

use async_trait::async_trait;
use std::{error::Error as StdError, sync::Arc, time::Duration};
use thiserror::Error;
use time::OffsetDateTime;
use uuid::Uuid;
use zipship_domain::{MemberRole, PermissionAction, UploadFilename, UploadSize, UploadStatus};

#[derive(Debug, Clone, Copy)]
pub struct UploadLimits {
    pub maximum_bytes: u64,
    pub upload_ttl: Duration,
    pub receive_lease: Duration,
}

impl Default for UploadLimits {
    fn default() -> Self {
        Self {
            maximum_bytes: 500 * 1_024 * 1_024,
            upload_ttl: Duration::from_secs(60 * 60),
            receive_lease: Duration::from_secs(60 * 60),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UploadRecord {
    pub id: Uuid,
    pub project_id: Uuid,
    pub release_id: Option<Uuid>,
    pub original_filename: String,
    pub status: UploadStatus,
    pub expected_size: u64,
    pub received_size: u64,
    pub staging_key: String,
    pub created_by: Uuid,
    pub created_at: OffsetDateTime,
    pub uploaded_at: Option<OffsetDateTime>,
    pub completed_at: Option<OffsetDateTime>,
    pub expires_at: OffsetDateTime,
    pub error_code: Option<String>,
}

#[derive(Debug, Clone)]
pub struct NewUpload {
    pub id: Uuid,
    pub project_id: Uuid,
    pub original_filename: UploadFilename,
    pub expected_size: UploadSize,
    pub staging_key: String,
    pub created_by: Uuid,
    pub created_at: OffsetDateTime,
    pub expires_at: OffsetDateTime,
}

#[derive(Debug)]
pub struct CreateUploadCommand {
    pub actor_id: Uuid,
    pub project_id: Uuid,
    pub original_filename: String,
    pub expected_size: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReceiveLease {
    pub upload: UploadRecord,
    pub transfer_id: Uuid,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BeginReceiveResult {
    Started(ReceiveLease),
    AlreadyUploaded(UploadRecord),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FinalizedUpload {
    pub upload: UploadRecord,
    pub release_id: Uuid,
    pub job_id: Uuid,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FinalizeResult {
    Created(FinalizedUpload),
    Existing(FinalizedUpload),
}

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

#[derive(Debug, Error, Clone, Copy, PartialEq, Eq)]
pub enum UploadsError {
    #[error("upload input is invalid")]
    InvalidInput,
    #[error("operation is forbidden")]
    Forbidden,
    #[error("upload was not found")]
    NotFound,
    #[error("upload state does not permit this operation")]
    StateConflict,
    #[error("upload has expired")]
    Expired,
    #[error("upload byte count did not match the declaration")]
    SizeMismatch,
    #[error("uploads infrastructure failed")]
    Infrastructure,
}

impl UploadsError {
    pub const fn code(self) -> &'static str {
        match self {
            Self::InvalidInput => "INVALID_UPLOAD_INPUT",
            Self::Forbidden => "FORBIDDEN",
            Self::NotFound => "UPLOAD_NOT_FOUND",
            Self::StateConflict => "UPLOAD_STATE_CONFLICT",
            Self::Expired => "UPLOAD_EXPIRED",
            Self::SizeMismatch => "UPLOAD_SIZE_MISMATCH",
            Self::Infrastructure => "UPLOADS_INFRASTRUCTURE_FAILURE",
        }
    }
}

#[derive(Clone)]
pub struct UploadsService {
    repository: Arc<dyn UploadsRepository>,
    clock: Arc<dyn Clock>,
    limits: UploadLimits,
}

impl UploadsService {
    pub fn new(repository: Arc<dyn UploadsRepository>, limits: UploadLimits) -> Self {
        Self::with_clock(repository, Arc::new(SystemClock), limits)
    }

    pub fn with_clock(
        repository: Arc<dyn UploadsRepository>,
        clock: Arc<dyn Clock>,
        limits: UploadLimits,
    ) -> Self {
        Self {
            repository,
            clock,
            limits,
        }
    }

    pub const fn maximum_bytes(&self) -> u64 {
        self.limits.maximum_bytes
    }

    pub async fn create(&self, command: CreateUploadCommand) -> Result<UploadRecord, UploadsError> {
        self.require_upload_permission(command.project_id, command.actor_id)
            .await?;
        let filename = UploadFilename::parse(&command.original_filename)
            .map_err(|_| UploadsError::InvalidInput)?;
        let expected_size = UploadSize::parse(command.expected_size, self.limits.maximum_bytes)
            .map_err(|_| UploadsError::InvalidInput)?;
        let now = self.clock.now();
        let upload_id = Uuid::new_v4();
        let expires_at = add_std_duration(now, self.limits.upload_ttl)?;
        self.repository
            .create_upload(NewUpload {
                id: upload_id,
                project_id: command.project_id,
                original_filename: filename,
                expected_size,
                staging_key: format!("uploads/{upload_id}/archive.zip"),
                created_by: command.actor_id,
                created_at: now,
                expires_at,
            })
            .await
            .map_err(map_repository_error)
    }

    pub async fn begin_receive(
        &self,
        upload_id: Uuid,
        actor_id: Uuid,
    ) -> Result<BeginReceiveResult, UploadsError> {
        let now = self.clock.now();
        let lease_expires_at = add_std_duration(now, self.limits.receive_lease)?;
        self.repository
            .begin_receive(upload_id, actor_id, Uuid::new_v4(), now, lease_expires_at)
            .await
            .map_err(map_repository_error)
    }

    pub async fn mark_uploaded(
        &self,
        lease: &ReceiveLease,
        actor_id: Uuid,
        received_size: u64,
    ) -> Result<UploadRecord, UploadsError> {
        if received_size != lease.upload.expected_size {
            return Err(UploadsError::SizeMismatch);
        }
        self.repository
            .mark_uploaded(
                lease.upload.id,
                actor_id,
                lease.transfer_id,
                received_size,
                self.clock.now(),
            )
            .await
            .map_err(map_repository_error)
    }

    pub async fn requeue_interrupted_receive(
        &self,
        lease: &ReceiveLease,
        actor_id: Uuid,
        error_code: &'static str,
    ) -> Result<(), UploadsError> {
        self.repository
            .requeue_receive(
                lease.upload.id,
                actor_id,
                lease.transfer_id,
                error_code,
                self.clock.now(),
            )
            .await
            .map_err(map_repository_error)
    }

    pub async fn finalize(
        &self,
        upload_id: Uuid,
        actor_id: Uuid,
    ) -> Result<FinalizeResult, UploadsError> {
        self.repository
            .finalize_upload(upload_id, actor_id, self.clock.now())
            .await
            .map_err(map_repository_error)
    }

    pub async fn get(&self, upload_id: Uuid, actor_id: Uuid) -> Result<UploadRecord, UploadsError> {
        self.repository
            .find_upload_for_member(upload_id, actor_id)
            .await
            .map_err(map_repository_error)?
            .ok_or(UploadsError::NotFound)
    }

    async fn require_upload_permission(
        &self,
        project_id: Uuid,
        actor_id: Uuid,
    ) -> Result<(), UploadsError> {
        let role = self
            .repository
            .project_role(project_id, actor_id)
            .await
            .map_err(map_repository_error)?
            .ok_or(UploadsError::NotFound)?;
        role.can(PermissionAction::UploadRelease)
            .then_some(())
            .ok_or(UploadsError::Forbidden)
    }
}

fn add_std_duration(
    value: OffsetDateTime,
    duration: Duration,
) -> Result<OffsetDateTime, UploadsError> {
    let seconds = i64::try_from(duration.as_secs()).map_err(|_| UploadsError::Infrastructure)?;
    value
        .checked_add(time::Duration::seconds(seconds))
        .ok_or(UploadsError::Infrastructure)
}

fn map_repository_error(error: UploadsRepositoryError) -> UploadsError {
    match error {
        UploadsRepositoryError::Forbidden => UploadsError::Forbidden,
        UploadsRepositoryError::NotFound => UploadsError::NotFound,
        UploadsRepositoryError::StateConflict => UploadsError::StateConflict,
        UploadsRepositoryError::Expired => UploadsError::Expired,
        UploadsRepositoryError::SizeMismatch => UploadsError::SizeMismatch,
        UploadsRepositoryError::Unavailable { .. } => UploadsError::Infrastructure,
    }
}

#[cfg(test)]
mod tests;
