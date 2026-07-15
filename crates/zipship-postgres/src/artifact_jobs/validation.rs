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
mod tests;
