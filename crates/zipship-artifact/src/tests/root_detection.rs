use super::*;

#[test]
fn requires_one_unambiguous_shallowest_index() {
    let temp = tempdir().unwrap();
    let missing = temp.path().join("missing.zip");
    write_zip(&missing, &[("site/readme.txt", b"missing")]);
    assert_eq!(
        extract_artifact(
            &missing,
            &temp.path().join("missing"),
            ArtifactLimits::default(),
        )
        .unwrap_err()
        .code(),
        "ARTIFACT_INDEX_MISSING",
    );

    let ambiguous = temp.path().join("ambiguous.zip");
    write_zip(
        &ambiguous,
        &[
            ("first/index.html", b"first"),
            ("second/index.html", b"second"),
        ],
    );
    assert_eq!(
        extract_artifact(
            &ambiguous,
            &temp.path().join("ambiguous"),
            ArtifactLimits::default(),
        )
        .unwrap_err()
        .code(),
        "ARTIFACT_INDEX_AMBIGUOUS",
    );
}
