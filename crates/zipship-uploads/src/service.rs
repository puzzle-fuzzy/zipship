use crate::{
    error::UploadsError,
    limits::UploadLimits,
    model::{
        BeginReceiveResult, CreateUploadCommand, FinalizeResult, NewUpload, ReceiveLease,
        UploadRecord,
    },
    repository::{Clock, SystemClock, UploadsRepository, UploadsRepositoryError},
};
use std::{sync::Arc, time::Duration};
use time::OffsetDateTime;
use uuid::Uuid;
use zipship_domain::{PermissionAction, UploadFilename, UploadSize};

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
        self.limits.maximum_bytes()
    }

    pub async fn create(&self, command: CreateUploadCommand) -> Result<UploadRecord, UploadsError> {
        self.require_upload_permission(command.project_id, command.actor_id)
            .await?;
        let filename = UploadFilename::parse(&command.original_filename)
            .map_err(|_| UploadsError::InvalidInput)?;
        let expected_size = UploadSize::parse(command.expected_size, self.limits.maximum_bytes())
            .map_err(|_| UploadsError::InvalidInput)?;
        let now = self.clock.now();
        let upload_id = Uuid::new_v4();
        let expires_at = add_std_duration(now, self.limits.upload_ttl())?;
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
        let lease_expires_at = add_std_duration(now, self.limits.receive_lease())?;
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
    let duration = time::Duration::try_from(duration).map_err(|_| UploadsError::Infrastructure)?;
    value
        .checked_add(duration)
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
