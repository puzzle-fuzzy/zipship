use sqlx::FromRow;
use std::str::FromStr;
use thiserror::Error;
use time::OffsetDateTime;
use uuid::Uuid;
use zipship_domain::{MemberRole, UploadStatus};
use zipship_uploads::{UploadRecord, UploadsRepositoryError};

pub(super) fn parse_role(value: &str) -> Result<MemberRole, UploadsRepositoryError> {
    MemberRole::from_str(value).map_err(|_| corrupt_record("memberships.role"))
}

#[derive(Debug, FromRow)]
pub(super) struct UploadRow {
    pub(super) id: Uuid,
    pub(super) project_id: Uuid,
    pub(super) release_id: Option<Uuid>,
    pub(super) original_filename: String,
    pub(super) state: String,
    pub(super) expected_size: i64,
    pub(super) received_size: i64,
    pub(super) staging_key: String,
    pub(super) created_by: Uuid,
    pub(super) created_at: OffsetDateTime,
    pub(super) uploaded_at: Option<OffsetDateTime>,
    pub(super) completed_at: Option<OffsetDateTime>,
    pub(super) expires_at: OffsetDateTime,
    pub(super) error_code: Option<String>,
}

impl TryFrom<UploadRow> for UploadRecord {
    type Error = UploadsRepositoryError;

    fn try_from(row: UploadRow) -> Result<Self, Self::Error> {
        let expected_staging_key = format!("uploads/{}/archive.zip", row.id);
        if row.staging_key != expected_staging_key {
            return Err(corrupt_record("uploads.staging_key"));
        }
        Ok(Self {
            id: row.id,
            project_id: row.project_id,
            release_id: row.release_id,
            original_filename: row.original_filename,
            status: UploadStatus::from_str(&row.state)
                .map_err(|_| corrupt_record("uploads.state"))?,
            expected_size: u64::try_from(row.expected_size)
                .map_err(|_| corrupt_record("uploads.expected_size"))?,
            received_size: u64::try_from(row.received_size)
                .map_err(|_| corrupt_record("uploads.received_size"))?,
            staging_key: row.staging_key,
            created_by: row.created_by,
            created_at: row.created_at,
            uploaded_at: row.uploaded_at,
            completed_at: row.completed_at,
            expires_at: row.expires_at,
            error_code: row.error_code,
        })
    }
}

#[derive(Debug, Error)]
#[error("database contains an invalid upload value in {field}")]
struct CorruptUploadRecord {
    field: &'static str,
}

pub(super) fn corrupt_record(field: &'static str) -> UploadsRepositoryError {
    UploadsRepositoryError::unavailable(CorruptUploadRecord { field })
}
