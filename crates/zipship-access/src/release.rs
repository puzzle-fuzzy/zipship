use std::collections::BTreeMap;

use thiserror::Error;
use uuid::Uuid;
use zipship_artifact::{ArtifactManifest, ManifestEntry};
use zipship_domain::{ArtifactDigest, CachePolicy, ProjectSlug};

const MANIFEST_VERSION: u32 = 1;
const MAX_ASSET_PATH_BYTES: usize = 4_096;

#[derive(Debug, Error, Clone, PartialEq, Eq)]
pub enum PreviewReleaseError {
    #[error("preview artifact metadata is inconsistent")]
    InvalidArtifactMetadata,
    #[error("preview artifact manifest is invalid")]
    InvalidManifest,
    #[error("preview artifact has no index.html")]
    MissingIndex,
}

#[derive(Debug, Clone)]
pub struct PreviewRelease {
    release_id: Uuid,
    project_slug: ProjectSlug,
    artifact_digest: ArtifactDigest,
    cache_policy: CachePolicy,
    spa_fallback: bool,
    files: BTreeMap<String, ManifestEntry>,
}

impl PreviewRelease {
    #[allow(clippy::too_many_arguments)]
    pub fn try_new(
        release_id: Uuid,
        project_slug: ProjectSlug,
        artifact_digest: ArtifactDigest,
        storage_key: &str,
        cache_policy: CachePolicy,
        spa_fallback: bool,
        expected_file_count: u32,
        expected_total_size: u64,
        manifest: ArtifactManifest,
    ) -> Result<Self, PreviewReleaseError> {
        if storage_key != expected_storage_key(&artifact_digest)
            || manifest.version != MANIFEST_VERSION
            || manifest.files.len() != expected_file_count as usize
            || manifest
                .files
                .iter()
                .try_fold(0_u64, |total, file| total.checked_add(file.size))
                != Some(expected_total_size)
        {
            return Err(PreviewReleaseError::InvalidArtifactMetadata);
        }

        let mut files = BTreeMap::new();
        for file in manifest.files {
            if !valid_asset_path(&file.path)
                || ArtifactDigest::parse(&file.sha256).is_err()
                || files.insert(file.path.clone(), file).is_some()
            {
                return Err(PreviewReleaseError::InvalidManifest);
            }
        }
        if !files.contains_key("index.html") {
            return Err(PreviewReleaseError::MissingIndex);
        }

        Ok(Self {
            release_id,
            project_slug,
            artifact_digest,
            cache_policy,
            spa_fallback,
            files,
        })
    }

    pub const fn release_id(&self) -> Uuid {
        self.release_id
    }

    pub fn project_slug(&self) -> &ProjectSlug {
        &self.project_slug
    }

    pub fn artifact_digest(&self) -> &ArtifactDigest {
        &self.artifact_digest
    }

    pub const fn cache_policy(&self) -> CachePolicy {
        self.cache_policy
    }

    pub const fn spa_fallback(&self) -> bool {
        self.spa_fallback
    }

    pub fn resolve_asset(
        &self,
        request_path: &str,
        accepts_html: bool,
    ) -> Result<Option<ResolvedAsset>, PreviewPathError> {
        let normalized = normalize_request_path(request_path)?;
        let exact = if normalized.is_empty() {
            "index.html".to_owned()
        } else {
            normalized.to_owned()
        };
        if let Some(file) = self.files.get(&exact) {
            return Ok(Some(ResolvedAsset::new(file.clone(), false)));
        }

        if !normalized.is_empty() {
            let directory_index = format!("{}/index.html", normalized.trim_end_matches('/'));
            if let Some(file) = self.files.get(&directory_index) {
                return Ok(Some(ResolvedAsset::new(file.clone(), false)));
            }
        }

        if self.spa_fallback && accepts_html {
            return Ok(self
                .files
                .get("index.html")
                .cloned()
                .map(|file| ResolvedAsset::new(file, true)));
        }
        Ok(None)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedAsset {
    pub path: String,
    pub size: u64,
    pub sha256: String,
    pub spa_fallback: bool,
}

impl ResolvedAsset {
    fn new(file: ManifestEntry, spa_fallback: bool) -> Self {
        Self {
            path: file.path,
            size: file.size,
            sha256: file.sha256,
            spa_fallback,
        }
    }
}

#[derive(Debug, Error, Clone, PartialEq, Eq)]
#[error("preview path is unsafe")]
pub struct PreviewPathError;

fn normalize_request_path(value: &str) -> Result<&str, PreviewPathError> {
    let normalized = value.strip_prefix('/').unwrap_or(value);
    let path = normalized.strip_suffix('/').unwrap_or(normalized);
    if path.is_empty() {
        return Ok("");
    }
    valid_path_components(path)
        .then_some(path)
        .ok_or(PreviewPathError)
}

fn valid_asset_path(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= MAX_ASSET_PATH_BYTES
        && !value.starts_with('/')
        && !value.ends_with('/')
        && valid_path_components(value)
}

fn valid_path_components(value: &str) -> bool {
    !value.contains(['\\', '\0'])
        && !value.chars().any(char::is_control)
        && value.split('/').all(|component| {
            !component.is_empty()
                && !matches!(component, "." | "..")
                && !component.contains(':')
                && !component.ends_with([' ', '.'])
        })
}

pub(crate) fn expected_storage_key(digest: &ArtifactDigest) -> String {
    let digest = digest.as_str();
    format!(
        "blobs/sha256/{}/{}/{}",
        &digest[0..2],
        &digest[2..4],
        digest
    )
}
