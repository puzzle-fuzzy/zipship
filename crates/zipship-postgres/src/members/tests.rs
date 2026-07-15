use super::*;

#[test]
fn rejects_unknown_roles() {
    assert!(parse_role("superuser").is_err());
}
