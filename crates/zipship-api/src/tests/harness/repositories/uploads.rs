use super::*;

#[derive(Default)]
struct UploadState {
    upload: Option<UploadRecord>,
    transfer_id: Option<Uuid>,
    finalized: Option<FinalizedUpload>,
}

#[derive(Default)]
pub(super) struct TestUploadsRepository {
    state: Mutex<UploadState>,
}
#[async_trait]
impl UploadsRepository for TestUploadsRepository {
    async fn project_role(
        &self,
        _project_id: Uuid,
        _actor_id: Uuid,
    ) -> Result<Option<MemberRole>, UploadsRepositoryError> {
        Ok(Some(MemberRole::Owner))
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
        if matches!(
            upload.status,
            UploadStatus::Uploaded | UploadStatus::Processing | UploadStatus::Completed
        ) {
            return Ok(BeginReceiveResult::AlreadyUploaded(upload.clone()));
        }
        if upload.status != UploadStatus::Pending {
            return Err(UploadsRepositoryError::StateConflict);
        }
        upload.status = UploadStatus::Receiving;
        upload.received_size = 0;
        upload.error_code = None;
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
        upload.error_code = None;
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
