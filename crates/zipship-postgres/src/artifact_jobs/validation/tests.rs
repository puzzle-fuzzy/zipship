use super::*;
use zipship_artifact::{ArtifactManifest, ManifestEntry, detect_artifact};
use zipship_domain::ArtifactDigest;

fn valid_artifact() -> ReadyArtifact {
    let digest = ArtifactDigest::parse("01".repeat(32)).unwrap();
    let manifest = ArtifactManifest {
        version: 1,
        files: vec![ManifestEntry {
            path: "index.html".to_owned(),
            size: 13,
            sha256: "ab".repeat(32),
        }],
    };
    let root = tempfile::tempdir().unwrap();
    std::fs::write(root.path().join("index.html"), "<main></main>").unwrap();
    let detect_report = detect_artifact(root.path(), &manifest).unwrap();
    ReadyArtifact {
        storage_key: format!("blobs/sha256/01/01/{}", digest.as_str()),
        digest,
        manifest,
        detect_report,
        file_count: 1,
        total_size: 13,
    }
}

#[test]
fn rejects_inconsistent_detection_reports() {
    let mut artifact = valid_artifact();
    artifact.detect_report.manifest_version = 2;
    assert!(validate_ready_artifact(&artifact).is_err());

    let mut artifact = valid_artifact();
    artifact.detect_report.insights.assets.total_size += 1;
    assert!(validate_ready_artifact(&artifact).is_err());

    let mut artifact = valid_artifact();
    artifact.detect_report.level = ArtifactReportLevel::Pass;
    assert!(validate_ready_artifact(&artifact).is_err());
}

#[test]
fn accepts_canonical_ready_artifacts() {
    assert!(validate_ready_artifact(&valid_artifact()).is_ok());
}

#[test]
fn rejects_mismatched_storage_and_manifest_metadata() {
    let mut artifact = valid_artifact();
    artifact.storage_key = "blobs/sha256/ff/ff/invalid".to_owned();
    assert!(matches!(
        validate_ready_artifact(&artifact),
        Err(ArtifactJobsRepositoryError::ArtifactConflict)
    ));

    let mut artifact = valid_artifact();
    artifact.total_size += 1;
    assert!(matches!(
        validate_ready_artifact(&artifact),
        Err(ArtifactJobsRepositoryError::ArtifactConflict)
    ));
}

#[test]
fn rejects_unsafe_or_unsorted_manifest_entries() {
    for path in ["../index.html", "/index.html", "nested\\index.html"] {
        let mut artifact = valid_artifact();
        artifact.manifest.files[0].path = path.to_owned();
        assert!(validate_ready_artifact(&artifact).is_err());
    }

    let mut artifact = valid_artifact();
    artifact.manifest.files.push(ManifestEntry {
        path: "asset.js".to_owned(),
        size: 0,
        sha256: "cd".repeat(32),
    });
    artifact.file_count = 2;
    assert!(validate_ready_artifact(&artifact).is_err());
}
