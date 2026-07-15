use super::row::UploadRow;
use super::*;

#[test]
fn rejects_invalid_staging_keys() {
    let row = UploadRow {
        id: Uuid::new_v4(),
        project_id: Uuid::new_v4(),
        release_id: None,
        original_filename: "frontend.zip".to_owned(),
        state: "pending".to_owned(),
        expected_size: 10,
        received_size: 0,
        staging_key: "../outside.zip".to_owned(),
        created_by: Uuid::new_v4(),
        created_at: OffsetDateTime::UNIX_EPOCH,
        uploaded_at: None,
        completed_at: None,
        expires_at: OffsetDateTime::UNIX_EPOCH + time::Duration::hours(1),
        error_code: None,
    };
    assert!(UploadRecord::try_from(row).is_err());
}
