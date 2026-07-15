use time::OffsetDateTime;
use uuid::Uuid;
use zipship_domain::{UploadFilename, UploadSize, UploadStatus};

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
