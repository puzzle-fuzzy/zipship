#![forbid(unsafe_code)]

use async_trait::async_trait;
use std::{collections::BTreeMap, error::Error as StdError};
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

#[derive(Debug, Error)]
pub enum PreviewRepositoryError {
    #[error("preview metadata is corrupt")]
    CorruptRecord,
    #[error("preview repository is unavailable")]
    Unavailable {
        #[source]
        source: Box<dyn StdError + Send + Sync>,
    },
}

impl PreviewRepositoryError {
    pub fn unavailable(source: impl StdError + Send + Sync + 'static) -> Self {
        Self::Unavailable {
            source: Box::new(source),
        }
    }
}

#[async_trait]
pub trait PreviewRepository: Send + Sync + 'static {
    async fn find_ready_release(
        &self,
        project_slug: &ProjectSlug,
        release_id: Uuid,
    ) -> Result<Option<PreviewRelease>, PreviewRepositoryError>;
}

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

fn expected_storage_key(digest: &ArtifactDigest) -> String {
    let digest = digest.as_str();
    format!(
        "blobs/sha256/{}/{}/{}",
        &digest[0..2],
        &digest[2..4],
        digest
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn release(spa_fallback: bool) -> PreviewRelease {
        let artifact_digest = ArtifactDigest::parse("ab".repeat(32)).unwrap();
        let files = vec![
            entry("assets/app.js", b"console.log('ready')"),
            entry("docs/index.html", b"docs"),
            entry("index.html", b"home"),
        ];
        let total_size = files.iter().map(|file| file.size).sum();
        PreviewRelease::try_new(
            Uuid::from_u128(10),
            ProjectSlug::parse("marketing").unwrap(),
            artifact_digest.clone(),
            &expected_storage_key(&artifact_digest),
            CachePolicy::Standard,
            spa_fallback,
            files.len() as u32,
            total_size,
            ArtifactManifest { version: 1, files },
        )
        .unwrap()
    }

    fn entry(path: &str, contents: &[u8]) -> ManifestEntry {
        let byte = contents.len() % 16;
        ManifestEntry {
            path: path.to_owned(),
            size: contents.len() as u64,
            sha256: format!("{byte:x}").repeat(64),
        }
    }

    #[test]
    fn resolves_roots_exact_assets_directory_indexes_and_spa_routes() {
        let release = release(true);
        assert_eq!(
            release.resolve_asset("", false).unwrap().unwrap().path,
            "index.html"
        );
        assert_eq!(
            release
                .resolve_asset("assets/app.js", false)
                .unwrap()
                .unwrap()
                .path,
            "assets/app.js"
        );
        assert_eq!(
            release.resolve_asset("docs/", false).unwrap().unwrap().path,
            "docs/index.html"
        );
        let fallback = release
            .resolve_asset("dashboard/settings", true)
            .unwrap()
            .unwrap();
        assert_eq!(fallback.path, "index.html");
        assert!(fallback.spa_fallback);
        assert_eq!(
            release.resolve_asset("assets/missing.js", false).unwrap(),
            None
        );
    }

    #[test]
    fn rejects_request_traversal_and_nonportable_separators() {
        let release = release(true);
        for path in ["../secret", "assets/../secret", "..\\secret", "a//b"] {
            assert!(release.resolve_asset(path, true).is_err(), "{path}");
        }
    }

    #[test]
    fn rejects_inconsistent_or_unsafe_manifests() {
        let digest = ArtifactDigest::parse("cd".repeat(32)).unwrap();
        let valid = entry("index.html", b"home");
        let build = |storage_key: &str, files: Vec<ManifestEntry>| {
            PreviewRelease::try_new(
                Uuid::nil(),
                ProjectSlug::parse("demo").unwrap(),
                digest.clone(),
                storage_key,
                CachePolicy::Aggressive,
                true,
                files.len() as u32,
                files.iter().map(|file| file.size).sum(),
                ArtifactManifest { version: 1, files },
            )
        };
        assert_eq!(
            build("wrong", vec![valid.clone()]).unwrap_err(),
            PreviewReleaseError::InvalidArtifactMetadata
        );
        let mut unsafe_entry = valid.clone();
        unsafe_entry.path = "../index.html".to_owned();
        assert_eq!(
            build(&expected_storage_key(&digest), vec![unsafe_entry]).unwrap_err(),
            PreviewReleaseError::InvalidManifest
        );
        assert_eq!(
            build(
                &expected_storage_key(&digest),
                vec![entry("app.js", b"app")]
            )
            .unwrap_err(),
            PreviewReleaseError::MissingIndex
        );
    }
}
