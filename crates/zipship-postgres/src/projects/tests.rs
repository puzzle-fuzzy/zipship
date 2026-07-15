use super::row::{parse_cache_policy, parse_role};

#[test]
fn rejects_unknown_roles_and_cache_policies() {
    assert!(parse_role("superuser").is_err());
    assert!(parse_cache_policy("forever").is_err());
}
