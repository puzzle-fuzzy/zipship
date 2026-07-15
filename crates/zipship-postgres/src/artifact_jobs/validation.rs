use zipship_artifact::{ArtifactJobsRepositoryError, ReadyArtifact};

pub(super) fn validate_ready_artifact(
    artifact: &ReadyArtifact,
) -> Result<(), ArtifactJobsRepositoryError> {
    let digest = artifact.digest.as_str();
    let expected_storage_key = format!(
        "blobs/sha256/{}/{}/{}",
        &digest[0..2],
        &digest[2..4],
        digest
    );
    if artifact.storage_key != expected_storage_key
        || artifact.manifest.version != 1
        || artifact.file_count == 0
        || artifact.manifest.files.len() != artifact.file_count as usize
        || artifact
            .manifest
            .files
            .windows(2)
            .any(|files| files[0].path >= files[1].path)
        || !artifact
            .manifest
            .files
            .iter()
            .any(|entry| entry.path == "index.html")
        || artifact.manifest.files.iter().any(|entry| {
            entry.path.is_empty()
                || entry.path.starts_with('/')
                || entry.path.contains('\\')
                || entry
                    .path
                    .split('/')
                    .any(|component| component.is_empty() || matches!(component, "." | ".."))
                || entry.sha256.len() != 64
                || !entry
                    .sha256
                    .bytes()
                    .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        })
        || artifact
            .manifest
            .files
            .iter()
            .try_fold(0_u64, |total, entry| total.checked_add(entry.size))
            != Some(artifact.total_size)
    {
        return Err(ArtifactJobsRepositoryError::ArtifactConflict);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use zipship_artifact::{ArtifactManifest, ManifestEntry};
    use zipship_domain::ArtifactDigest;

    fn valid_artifact() -> ReadyArtifact {
        let digest = ArtifactDigest::parse("01".repeat(32)).unwrap();
        ReadyArtifact {
            storage_key: format!("blobs/sha256/01/01/{}", digest.as_str()),
            digest,
            manifest: ArtifactManifest {
                version: 1,
                files: vec![ManifestEntry {
                    path: "index.html".to_owned(),
                    size: 13,
                    sha256: "ab".repeat(32),
                }],
            },
            file_count: 1,
            total_size: 13,
        }
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
}
