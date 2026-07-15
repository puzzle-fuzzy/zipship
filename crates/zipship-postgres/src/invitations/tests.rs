use super::row::{parse_role, parse_state};

#[test]
fn rejects_unknown_roles_and_states() {
    assert!(parse_role("superuser").is_err());
    assert!(parse_state("unknown").is_err());
}
