use super::*;

#[test]
fn validates_project_slugs() {
    assert_eq!(
        ProjectSlug::parse("marketing_site").unwrap().as_str(),
        "marketing_site"
    );
    assert!(ProjectSlug::parse("_api").is_err());
    assert!(ProjectSlug::parse("Uppercase").is_err());
    assert!(ProjectSlug::parse("-leading").is_err());
    assert!(ProjectSlug::parse("a".repeat(64)).is_err());
    assert_eq!(
        ProjectSlug::parse_normalized(" Marketing-Site ")
            .unwrap()
            .as_str(),
        "marketing-site",
    );
}

#[test]
fn normalizes_organization_and_project_metadata() {
    assert_eq!(
        OrganizationName::parse("  Puzzle Fuzzy  ")
            .unwrap()
            .as_str(),
        "Puzzle Fuzzy",
    );
    assert_eq!(
        OrganizationSlug::parse_normalized(" Puzzle-Fuzzy ")
            .unwrap()
            .as_str(),
        "puzzle-fuzzy",
    );
    assert_eq!(
        ProjectName::parse("  Marketing Site  ").unwrap().as_str(),
        "Marketing Site",
    );
    assert_eq!(
        ProjectDescription::parse(Some("  Static campaign site  "))
            .unwrap()
            .as_deref(),
        Some("Static campaign site"),
    );
    assert_eq!(
        ProjectDescription::parse(Some("  ")).unwrap().as_deref(),
        None,
    );
}
