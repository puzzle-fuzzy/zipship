use super::*;

#[test]
fn rejects_running_rows_without_a_complete_lease() {
    let row = JobRow {
        id: Uuid::new_v4(),
        kind: "artifact.process".to_owned(),
        domain_id: None,
        status: "running".to_owned(),
        priority: 0,
        attempts: 1,
        max_attempts: 5,
        next_run_at: OffsetDateTime::UNIX_EPOCH,
        locked_by: None,
        locked_until: None,
        heartbeat_at: None,
        input_json: serde_json::json!({}),
        output_json: None,
        error_code: None,
    };
    assert!(JobRecord::try_from(row).is_err());
}
