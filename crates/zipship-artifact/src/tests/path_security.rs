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
fn rejects_absolute_non_normalized_and_windows_unsafe_components() {
    for (name, path) in [
        ("absolute", "/site/index.html"),
        ("empty-component", "site//index.html"),
        ("dot-component", "site/./index.html"),
        ("drive-or-ads", "site/C:/index.html"),
        ("trailing-dot", "site./index.html"),
        ("trailing-space", "site /index.html"),
        ("reserved-device", "site/LPT9.txt"),
        ("decomposed-unicode", "site/cafe\u{301}/index.html"),
        ("control-character", "site/\u{0001}bad/index.html"),
    ] {
        let temp = tempdir().unwrap();
        let archive = temp.path().join(format!("{name}.zip"));
        let destination = temp.path().join("expanded");
        write_zip(&archive, &[(path, b"unsafe")]);

        let error =
            extract_artifact(&archive, &destination, ArtifactLimits::default()).unwrap_err();
        assert_eq!(error.code(), "UNSAFE_ZIP_PATH", "{name}: {path:?}");
        assert!(!destination.exists());
    }
}

#[test]
fn rejects_entry_paths_over_the_portable_byte_limit() {
    let temp = tempdir().unwrap();
    let archive = temp.path().join("long-path.zip");
    let destination = temp.path().join("expanded");
    let long_path = format!("{}/index.html", "a".repeat(4_096));
    write_zip(&archive, &[(long_path.as_str(), b"index")]);

    let error = extract_artifact(&archive, &destination, ArtifactLimits::default()).unwrap_err();
    assert_eq!(error.code(), "UNSAFE_ZIP_PATH");
    assert!(!destination.exists());
}

#[test]
fn rejects_exact_duplicate_paths_from_untrusted_archives() {
    let temp = tempdir().unwrap();
    let archive = temp.path().join("duplicate.zip");
    let destination = temp.path().join("expanded");
    let first_name = b"site/duplicate-a.html";
    let second_name = b"site/duplicate-b.html";
    write_zip(
        &archive,
        &[
            (std::str::from_utf8(first_name).unwrap(), b"first"),
            (std::str::from_utf8(second_name).unwrap(), b"second"),
        ],
    );
    let mut bytes = fs::read(&archive).unwrap();
    let mut replacements = 0;
    for offset in 0..=bytes.len() - second_name.len() {
        if bytes[offset..].starts_with(second_name) {
            bytes[offset..offset + first_name.len()].copy_from_slice(first_name);
            replacements += 1;
        }
    }
    assert_eq!(replacements, 2, "local and central names must be rewritten");
    fs::write(&archive, bytes).unwrap();

    let error = extract_artifact(&archive, &destination, ArtifactLimits::default()).unwrap_err();
    assert_eq!(error.code(), "DUPLICATE_ZIP_PATH");
    assert!(!destination.exists());

    let limits = ArtifactLimits {
        maximum_entries: 1,
        ..ArtifactLimits::default()
    };
    let error = extract_artifact(&archive, &destination, limits).unwrap_err();
    assert_eq!(error.code(), "ZIP_ENTRY_LIMIT_EXCEEDED");
    assert!(!destination.exists());
}

#[test]
fn rejects_path_conflicts_in_either_order() {
    for (name, entries, expected) in [
        (
            "parent-first",
            vec![
                ("site", b"file".as_slice()),
                ("site/index.html", b"index".as_slice()),
            ],
            "ZIP_PATH_CONFLICT",
        ),
        (
            "child-first",
            vec![
                ("site/index.html", b"index".as_slice()),
                ("site", b"file".as_slice()),
            ],
            "ZIP_PATH_CONFLICT",
        ),
    ] {
        let temp = tempdir().unwrap();
        let archive = temp.path().join(format!("{name}.zip"));
        let destination = temp.path().join("expanded");
        write_zip(&archive, &entries);

        let error =
            extract_artifact(&archive, &destination, ArtifactLimits::default()).unwrap_err();
        assert_eq!(error.code(), expected, "{name}");
        assert!(!destination.exists());
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
