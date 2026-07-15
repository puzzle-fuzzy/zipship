use super::*;

#[test]
fn resolves_roots_exact_assets_directory_indexes_and_spa_routes() {
    let release = release(true);
    assert_eq!(
        release.resolve_asset("", false).unwrap().unwrap().path,
        "index.html"
    );
    assert_eq!(
        release
            .resolve_asset("assets/app.js", false)
            .unwrap()
            .unwrap()
            .path,
        "assets/app.js"
    );
    assert_eq!(
        release.resolve_asset("docs/", false).unwrap().unwrap().path,
        "docs/index.html"
    );
    let fallback = release
        .resolve_asset("dashboard/settings", true)
        .unwrap()
        .unwrap();
    assert_eq!(fallback.path, "index.html");
    assert!(fallback.spa_fallback);
    assert_eq!(
        release.resolve_asset("assets/missing.js", false).unwrap(),
        None
    );
}

#[test]
fn rejects_request_traversal_and_nonportable_separators() {
    let release = release(true);
    for path in ["../secret", "assets/../secret", "..\\secret", "a//b"] {
        assert!(release.resolve_asset(path, true).is_err(), "{path}");
    }
}

#[test]
fn rejects_inconsistent_or_unsafe_manifests() {
    let digest = ArtifactDigest::parse("cd".repeat(32)).unwrap();
    let valid = entry("index.html", b"home");
    let build = |storage_key: &str, files: Vec<ManifestEntry>| {
        PreviewRelease::try_new(
            Uuid::nil(),
            ProjectSlug::parse("demo").unwrap(),
            digest.clone(),
            storage_key,
            CachePolicy::Aggressive,
            true,
            files.len() as u32,
            files.iter().map(|file| file.size).sum(),
            ArtifactManifest { version: 1, files },
        )
    };
    assert_eq!(
        build("wrong", vec![valid.clone()]).unwrap_err(),
        PreviewReleaseError::InvalidArtifactMetadata
    );
    let mut unsafe_entry = valid.clone();
    unsafe_entry.path = "../index.html".to_owned();
    assert_eq!(
        build(&expected_storage_key(&digest), vec![unsafe_entry]).unwrap_err(),
        PreviewReleaseError::InvalidManifest
    );
    assert_eq!(
        build(
            &expected_storage_key(&digest),
            vec![entry("app.js", b"app")]
        )
        .unwrap_err(),
        PreviewReleaseError::MissingIndex
    );
}
