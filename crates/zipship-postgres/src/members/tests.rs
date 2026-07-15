use super::row::parse_role;

#[test]
fn rejects_unknown_roles() {
    assert!(parse_role("superuser").is_err());
}
