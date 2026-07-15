use super::*;

#[test]
fn rejects_traversal_nonportable_and_case_colliding_paths() {
    for (name, entries, expected) in [
        (
            "traversal",
            vec![("../outside.txt", b"bad".as_slice())],
            "UNSAFE_ZIP_PATH",
        ),
        (
            "backslash",
            vec![("..\\outside.txt", b"bad".as_slice())],
            "UNSAFE_ZIP_PATH",
        ),
        (
            "reserved",
            vec![("site/CON.txt", b"bad".as_slice())],
            "UNSAFE_ZIP_PATH",
        ),
        (
            "collision",
            vec![
                ("site/index.html", b"first".as_slice()),
                ("site/INDEX.HTML", b"second".as_slice()),
            ],
            "DUPLICATE_ZIP_PATH",
        ),
        (
            "directory-casing",
            vec![
                ("SITE/assets/app.js", b"first".as_slice()),
                ("site/index.html", b"second".as_slice()),
            ],
            "DUPLICATE_ZIP_PATH",
        ),
    ] {
        let temp = tempdir().unwrap();
        let archive = temp.path().join(format!("{name}.zip"));
        let destination = temp.path().join("expanded");
        write_zip(&archive, &entries);
        let error =
            extract_artifact(&archive, &destination, ArtifactLimits::default()).unwrap_err();
        assert_eq!(error.code(), expected);
        assert!(!destination.exists());
        assert!(!temp.path().join("outside.txt").exists());
    }
}

#[test]
fn rejects_symlinks_and_file_directory_conflicts() {
    let temp = tempdir().unwrap();
    let symlink_zip = temp.path().join("symlink.zip");
    let file = File::create(&symlink_zip).unwrap();
    let mut writer = ZipWriter::new(file);
    writer
        .add_symlink("site/link", "../../outside", SimpleFileOptions::default())
        .unwrap();
    writer.finish().unwrap();
    assert_eq!(
        extract_artifact(
            &symlink_zip,
            &temp.path().join("symlink-expanded"),
            ArtifactLimits::default(),
        )
        .unwrap_err()
        .code(),
        "UNSUPPORTED_ZIP_ENTRY_TYPE",
    );

    let conflict_zip = temp.path().join("conflict.zip");
    write_zip(
        &conflict_zip,
        &[("site", b"file"), ("site/index.html", b"<main></main>")],
    );
    assert_eq!(
        extract_artifact(
            &conflict_zip,
            &temp.path().join("conflict-expanded"),
            ArtifactLimits::default(),
        )
        .unwrap_err()
        .code(),
        "ZIP_PATH_CONFLICT",
    );
}
