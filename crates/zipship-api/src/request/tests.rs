use super::*;

#[test]
fn parses_exact_case_insensitive_bearer_credentials() {
    assert_eq!(parse_bearer("Bearer zps_secret"), Some("zps_secret"));
    assert_eq!(parse_bearer("bearer\tzps_secret"), Some("zps_secret"));
    assert_eq!(parse_bearer("Basic zps_secret"), None);
    assert_eq!(parse_bearer("Bearer"), None);
    assert_eq!(parse_bearer("Bearer a b"), None);
}
