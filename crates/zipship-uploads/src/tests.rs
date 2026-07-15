use super::*;
use async_trait::async_trait;
use std::{
    sync::{Arc, Mutex},
    time::Duration,
};
use time::OffsetDateTime;
use uuid::Uuid;
use zipship_domain::{MemberRole, UploadStatus};

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
        UploadLimits::new(1_024, Duration::from_secs(600), Duration::from_secs(60)).unwrap(),
    );
    (repository, service)
}

#[test]
fn rejects_limits_that_expire_or_overrun_the_application_clock() {
    assert_eq!(
        UploadLimits::new(0, Duration::from_secs(600), Duration::from_secs(60)),
        Err(UploadLimitsError::InvalidMaximumBytes)
    );
    assert_eq!(
        UploadLimits::new(1_024, Duration::from_millis(999), Duration::from_secs(60)),
        Err(UploadLimitsError::InvalidUploadTtl)
    );
    assert_eq!(
        UploadLimits::new(1_024, Duration::from_secs(600), Duration::from_millis(999)),
        Err(UploadLimitsError::InvalidReceiveLease)
    );
    assert_eq!(
        UploadLimits::new(1_024, Duration::MAX, Duration::from_secs(60)),
        Err(UploadLimitsError::InvalidUploadTtl)
    );
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
