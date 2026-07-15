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
mod tests {
    use super::*;
    use std::sync::Mutex;

    const NOW: OffsetDateTime = OffsetDateTime::UNIX_EPOCH;

    #[derive(Default)]
    struct State {
        role: Option<MemberRole>,
        upload: Option<UploadRecord>,
        transfer_id: Option<Uuid>,
        finalized: Option<FinalizedUpload>,
    }

    #[derive(Default)]
    struct InMemoryRepository {
        state: Mutex<State>,
    }

    #[async_trait]
    impl UploadsRepository for InMemoryRepository {
        async fn project_role(
            &self,
            _project_id: Uuid,
            _actor_id: Uuid,
        ) -> Result<Option<MemberRole>, UploadsRepositoryError> {
            Ok(self.state.lock().unwrap().role)
        }

        async fn create_upload(
            &self,
            upload: NewUpload,
        ) -> Result<UploadRecord, UploadsRepositoryError> {
            let record = UploadRecord {
                id: upload.id,
                project_id: upload.project_id,
                release_id: None,
                original_filename: upload.original_filename.as_str().to_owned(),
                status: UploadStatus::Pending,
                expected_size: upload.expected_size.bytes(),
                received_size: 0,
                staging_key: upload.staging_key,
                created_by: upload.created_by,
                created_at: upload.created_at,
                uploaded_at: None,
                completed_at: None,
                expires_at: upload.expires_at,
                error_code: None,
            };
            self.state.lock().unwrap().upload = Some(record.clone());
            Ok(record)
        }

        async fn begin_receive(
            &self,
            upload_id: Uuid,
            _actor_id: Uuid,
            transfer_id: Uuid,
            now: OffsetDateTime,
            _lease_expires_at: OffsetDateTime,
        ) -> Result<BeginReceiveResult, UploadsRepositoryError> {
            let mut state = self.state.lock().unwrap();
            let upload = state
                .upload
                .as_mut()
                .filter(|upload| upload.id == upload_id)
                .ok_or(UploadsRepositoryError::NotFound)?;
            if upload.expires_at <= now {
                return Err(UploadsRepositoryError::Expired);
            }
            if upload.status == UploadStatus::Uploaded {
                return Ok(BeginReceiveResult::AlreadyUploaded(upload.clone()));
            }
            if upload.status != UploadStatus::Pending {
                return Err(UploadsRepositoryError::StateConflict);
            }
            upload.status = UploadStatus::Receiving;
            upload.received_size = 0;
            let upload = upload.clone();
            state.transfer_id = Some(transfer_id);
            Ok(BeginReceiveResult::Started(ReceiveLease {
                upload,
                transfer_id,
            }))
        }

        async fn mark_uploaded(
            &self,
            upload_id: Uuid,
            _actor_id: Uuid,
            transfer_id: Uuid,
            received_size: u64,
            now: OffsetDateTime,
        ) -> Result<UploadRecord, UploadsRepositoryError> {
            let mut state = self.state.lock().unwrap();
            if state.transfer_id != Some(transfer_id) {
                return Err(UploadsRepositoryError::StateConflict);
            }
            let upload = state
                .upload
                .as_mut()
                .filter(|upload| upload.id == upload_id)
                .ok_or(UploadsRepositoryError::NotFound)?;
            if received_size != upload.expected_size {
                return Err(UploadsRepositoryError::SizeMismatch);
            }
            upload.status = UploadStatus::Uploaded;
            upload.received_size = received_size;
            upload.uploaded_at = Some(now);
            Ok(upload.clone())
        }

        async fn requeue_receive(
            &self,
            upload_id: Uuid,
            _actor_id: Uuid,
            transfer_id: Uuid,
            error_code: &'static str,
            _now: OffsetDateTime,
        ) -> Result<(), UploadsRepositoryError> {
            let mut state = self.state.lock().unwrap();
            if state.transfer_id != Some(transfer_id) {
                return Err(UploadsRepositoryError::StateConflict);
            }
            let upload = state
                .upload
                .as_mut()
                .filter(|upload| upload.id == upload_id)
                .ok_or(UploadsRepositoryError::NotFound)?;
            upload.status = UploadStatus::Pending;
            upload.received_size = 0;
            upload.error_code = Some(error_code.to_owned());
            state.transfer_id = None;
            Ok(())
        }

        async fn finalize_upload(
            &self,
            upload_id: Uuid,
            _actor_id: Uuid,
            _now: OffsetDateTime,
        ) -> Result<FinalizeResult, UploadsRepositoryError> {
            let mut state = self.state.lock().unwrap();
            if let Some(finalized) = state.finalized.clone() {
                return Ok(FinalizeResult::Existing(finalized));
            }
            let upload = state
                .upload
                .as_mut()
                .filter(|upload| upload.id == upload_id)
                .ok_or(UploadsRepositoryError::NotFound)?;
            if upload.status != UploadStatus::Uploaded {
                return Err(UploadsRepositoryError::StateConflict);
            }
            let release_id = Uuid::new_v4();
            let job_id = Uuid::new_v4();
            upload.status = UploadStatus::Processing;
            upload.release_id = Some(release_id);
            let finalized = FinalizedUpload {
                upload: upload.clone(),
                release_id,
                job_id,
            };
            state.finalized = Some(finalized.clone());
            Ok(FinalizeResult::Created(finalized))
        }

        async fn find_upload_for_member(
            &self,
            upload_id: Uuid,
            _actor_id: Uuid,
        ) -> Result<Option<UploadRecord>, UploadsRepositoryError> {
            Ok(self
                .state
                .lock()
                .unwrap()
                .upload
                .clone()
                .filter(|upload| upload.id == upload_id))
        }
    }

    struct FixedClock;

    impl Clock for FixedClock {
        fn now(&self) -> OffsetDateTime {
            NOW
        }
    }

    fn service(role: MemberRole) -> (Arc<InMemoryRepository>, UploadsService) {
        let repository = Arc::new(InMemoryRepository::default());
        repository.state.lock().unwrap().role = Some(role);
        let service = UploadsService::with_clock(
            repository.clone(),
            Arc::new(FixedClock),
            UploadLimits {
                maximum_bytes: 1_024,
                upload_ttl: Duration::from_secs(600),
                receive_lease: Duration::from_secs(60),
            },
        );
        (repository, service)
    }

    fn create_command() -> CreateUploadCommand {
        CreateUploadCommand {
            actor_id: Uuid::new_v4(),
            project_id: Uuid::new_v4(),
            original_filename: "frontend.zip".to_owned(),
            expected_size: 512,
        }
    }

    #[tokio::test]
    async fn developers_create_bounded_uploads() {
        let (_, service) = service(MemberRole::Developer);
        let upload = service.create(create_command()).await.unwrap();
        assert_eq!(upload.status, UploadStatus::Pending);
        assert_eq!(upload.expected_size, 512);
        assert_eq!(upload.expires_at, NOW + time::Duration::minutes(10));
        assert_eq!(
            upload.staging_key,
            format!("uploads/{}/archive.zip", upload.id),
        );
    }

    #[tokio::test]
    async fn viewers_and_deployers_cannot_create_uploads() {
        for role in [MemberRole::Viewer, MemberRole::Deployer] {
            let (_, service) = service(role);
            assert_eq!(
                service.create(create_command()).await,
                Err(UploadsError::Forbidden),
            );
        }
    }

    #[tokio::test]
    async fn validates_filename_and_size_before_creating_records() {
        let (_, service) = service(MemberRole::Owner);
        let mut command = create_command();
        command.original_filename = "../frontend.zip".to_owned();
        assert_eq!(
            service.create(command).await,
            Err(UploadsError::InvalidInput),
        );
        let mut command = create_command();
        command.expected_size = 1_025;
        assert_eq!(
            service.create(command).await,
            Err(UploadsError::InvalidInput),
        );
    }

    #[tokio::test]
    async fn interrupted_receives_can_retry_and_finalize_idempotently() {
        let (_, service) = service(MemberRole::Owner);
        let actor_id = Uuid::new_v4();
        let mut command = create_command();
        command.actor_id = actor_id;
        let upload = service.create(command).await.unwrap();
        let BeginReceiveResult::Started(first_lease) =
            service.begin_receive(upload.id, actor_id).await.unwrap()
        else {
            panic!("expected a new receive lease");
        };
        service
            .requeue_interrupted_receive(&first_lease, actor_id, "UPLOAD_STREAM_INTERRUPTED")
            .await
            .unwrap();
        let BeginReceiveResult::Started(second_lease) =
            service.begin_receive(upload.id, actor_id).await.unwrap()
        else {
            panic!("expected a retry receive lease");
        };
        assert_ne!(first_lease.transfer_id, second_lease.transfer_id);
        service
            .mark_uploaded(&second_lease, actor_id, upload.expected_size)
            .await
            .unwrap();
        let created = service.finalize(upload.id, actor_id).await.unwrap();
        let existing = service.finalize(upload.id, actor_id).await.unwrap();
        let FinalizeResult::Created(created) = created else {
            panic!("expected first finalization to create records");
        };
        assert_eq!(existing, FinalizeResult::Existing(created));
    }
}
