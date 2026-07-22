use zipship_artifact::{
    ArtifactIssueLevel, ArtifactJobsRepositoryError, ArtifactReportLevel, ReadyArtifact,
    SeoCheckStatus,
};

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
    let report = &artifact.detect_report;
    let asset_type_summaries = [
        report.insights.assets.by_type.html,
        report.insights.assets.by_type.javascript,
        report.insights.assets.by_type.css,
        report.insights.assets.by_type.images,
        report.insights.assets.by_type.fonts,
        report.insights.assets.by_type.maps,
        report.insights.assets.by_type.other,
    ];
    let report_level = if report
        .items
        .iter()
        .any(|item| item.level == ArtifactIssueLevel::Failed)
    {
        ArtifactReportLevel::Failed
    } else if report
        .items
        .iter()
        .any(|item| item.level == ArtifactIssueLevel::Warning)
        || report
            .insights
            .seo
            .checks
            .iter()
            .any(|check| check.status == SeoCheckStatus::Warning)
    {
        ArtifactReportLevel::Warning
    } else {
        ArtifactReportLevel::Pass
    };
    let seo_passed = report
        .insights
        .seo
        .checks
        .iter()
        .filter(|check| check.status == SeoCheckStatus::Pass)
        .count();
    let expected_seo_score = u8::try_from(
        (seo_passed * 100 + report.insights.seo.checks.len() / 2)
            / report.insights.seo.checks.len().max(1),
    )
    .unwrap_or(u8::MAX);

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
        || report.report_version != 1
        || report.manifest_version != artifact.manifest.version
        || report.entry_point != "index.html"
        || report.insights.entrypoint != "index.html"
        || report.insights.assets.total_files != artifact.file_count
        || report.insights.assets.total_size != artifact.total_size
        || asset_type_summaries
            .iter()
            .try_fold(0_u32, |total, summary| total.checked_add(summary.count))
            != Some(artifact.file_count)
        || asset_type_summaries
            .iter()
            .try_fold(0_u64, |total, summary| {
                total.checked_add(summary.total_size)
            })
            != Some(artifact.total_size)
        || report.insights.assets.largest_files.len() > 5
        || report.insights.assets.largest_files.iter().any(|file| {
            !artifact
                .manifest
                .files
                .iter()
                .any(|entry| entry.path == file.path && entry.size == file.size)
        })
        || report.insights.seo.checks.len() != 6
        || report.insights.seo.score != expected_seo_score
        || report.level != report_level
    {
        return Err(ArtifactJobsRepositoryError::ArtifactConflict);
    }
    Ok(())
}

#[cfg(test)]
mod tests;
