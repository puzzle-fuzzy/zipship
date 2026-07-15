use super::*;

#[test]
fn enforces_entry_size_total_size_depth_and_ratio_limits() {
    let temp = tempdir().unwrap();
    let archive = temp.path().join("limits.zip");
    write_zip(
        &archive,
        &[
            ("site/index.html", b"<main></main>"),
            ("site/assets/app.js", &vec![b'x'; 2 * 1_024 * 1_024]),
        ],
    );
    let strict_ratio = ArtifactLimits {
        maximum_compression_ratio: 10,
        compression_ratio_grace_bytes: 0,
        ..ArtifactLimits::default()
    };
    assert_eq!(
        extract_artifact(&archive, &temp.path().join("ratio"), strict_ratio)
            .unwrap_err()
            .code(),
        "ZIP_COMPRESSION_RATIO_EXCEEDED",
    );
    let strict_file = ArtifactLimits {
        maximum_file_bytes: 1_024,
        ..ArtifactLimits::default()
    };
    assert_eq!(
        extract_artifact(&archive, &temp.path().join("file"), strict_file)
            .unwrap_err()
            .code(),
        "ZIP_FILE_SIZE_LIMIT_EXCEEDED",
    );
    let strict_total = ArtifactLimits {
        maximum_expanded_bytes: 1_024,
        ..ArtifactLimits::default()
    };
    assert_eq!(
        extract_artifact(&archive, &temp.path().join("total"), strict_total)
            .unwrap_err()
            .code(),
        "ZIP_EXPANDED_SIZE_LIMIT_EXCEEDED",
    );

    let deep_zip = temp.path().join("deep.zip");
    write_zip(&deep_zip, &[("a/b/c/index.html", b"index")]);
    let shallow = ArtifactLimits {
        maximum_path_depth: 3,
        ..ArtifactLimits::default()
    };
    assert_eq!(
        extract_artifact(&deep_zip, &temp.path().join("deep"), shallow)
            .unwrap_err()
            .code(),
        "ZIP_PATH_DEPTH_EXCEEDED",
    );
}
