use super::*;

#[test]
fn extracts_a_wrapped_site_and_hashes_the_manifest_deterministically() {
    let temp = tempdir().unwrap();
    let first_zip = temp.path().join("first.zip");
    let second_zip = temp.path().join("second.zip");
    write_zip(
        &first_zip,
        &[
            ("site/assets/app.js", b"console.log('ready')"),
            ("site/index.html", b"<main>ZipShip</main>"),
            ("README.txt", b"not part of the served artifact"),
        ],
    );
    write_zip(
        &second_zip,
        &[
            ("README.txt", b"not part of the served artifact"),
            ("site/index.html", b"<main>ZipShip</main>"),
            ("site/assets/app.js", b"console.log('ready')"),
        ],
    );

    let first = extract_artifact(
        &first_zip,
        &temp.path().join("first-expanded"),
        ArtifactLimits::default(),
    )
    .unwrap();
    let second = extract_artifact(
        &second_zip,
        &temp.path().join("second-expanded"),
        ArtifactLimits::default(),
    )
    .unwrap();
    assert!(first.root.ends_with(Path::new("first-expanded/site")));
    assert_eq!(first.digest, second.digest);
    assert_eq!(first.manifest, second.manifest);
    assert_eq!(first.file_count, 2);
    assert_eq!(
        first
            .manifest
            .files
            .iter()
            .map(|entry| entry.path.as_str())
            .collect::<Vec<_>>(),
        ["assets/app.js", "index.html"],
    );
    assert_eq!(
        fs::read_to_string(first.root.join("index.html")).unwrap(),
        "<main>ZipShip</main>",
    );
}

#[test]
fn removes_partial_destinations_for_invalid_archives() {
    let temp = tempdir().unwrap();
    let archive = temp.path().join("invalid.zip");
    let destination = temp.path().join("expanded");
    fs::write(&archive, b"this is not a ZIP archive").unwrap();

    let error = extract_artifact(&archive, &destination, ArtifactLimits::default()).unwrap_err();
    assert_eq!(error.code(), "INVALID_ZIP_ARCHIVE");
    assert!(!destination.exists());
}

#[test]
fn refuses_to_overwrite_an_existing_destination() {
    let temp = tempdir().unwrap();
    let archive = temp.path().join("site.zip");
    let destination = temp.path().join("expanded");
    write_zip(&archive, &[("index.html", b"new")]);
    fs::create_dir(&destination).unwrap();
    fs::write(destination.join("sentinel.txt"), b"preserve").unwrap();

    let error = extract_artifact(&archive, &destination, ArtifactLimits::default()).unwrap_err();
    assert_eq!(error.code(), "ARTIFACT_DESTINATION_EXISTS");
    assert_eq!(
        fs::read(destination.join("sentinel.txt")).unwrap(),
        b"preserve"
    );
}
