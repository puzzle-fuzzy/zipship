use super::row::valid_display_prefix;

#[test]
fn validates_display_prefixes_without_accepting_unicode_or_wrong_lengths() {
    assert!(valid_display_prefix("zps_abCD09_-"));
    assert!(!valid_display_prefix("zps_short"));
    assert!(!valid_display_prefix("zps_abcdefgh1"));
    assert!(!valid_display_prefix("zps_ébcdefgh"));
    assert!(!valid_display_prefix("bad_abcdefgh"));
}
