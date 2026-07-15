use std::sync::Arc;

use async_trait::async_trait;
use axum::Router;
use tempfile::TempDir;
use uuid::Uuid;
use zipship_artifact::{ArtifactManifest, ManifestEntry};
use zipship_domain::{ArtifactDigest, CachePolicy, ProjectSlug};
use zipship_storage::LocalArtifactStore;

use super::*;
use crate::release::expected_storage_key;

mod http;
mod http_policy;
mod release;

fn release(spa_fallback: bool) -> PreviewRelease {
    release_with_policy(spa_fallback, CachePolicy::Standard)
}

fn release_with_policy(spa_fallback: bool, cache_policy: CachePolicy) -> PreviewRelease {
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
        cache_policy,
        spa_fallback,
        files.len() as u32,
        total_size,
        ArtifactManifest { version: 1, files },
    )
    .unwrap()
}

#[derive(Clone)]
struct StaticRepository {
    release: PreviewRelease,
}

#[async_trait]
impl PreviewRepository for StaticRepository {
    async fn find_ready_release(
        &self,
        project_slug: &ProjectSlug,
        release_id: Uuid,
    ) -> Result<Option<PreviewRelease>, PreviewRepositoryError> {
        Ok(
            (self.release.project_slug() == project_slug
                && self.release.release_id() == release_id)
                .then(|| self.release.clone()),
        )
    }

    async fn find_active_release(
        &self,
        project_slug: &ProjectSlug,
    ) -> Result<Option<PreviewRelease>, PreviewRepositoryError> {
        Ok((self.release.project_slug() == project_slug).then(|| self.release.clone()))
    }
}

async fn http_fixture(cache_policy: CachePolicy) -> (Router, TempDir, Uuid) {
    let release = release_with_policy(true, cache_policy);
    let release_id = release.release_id();
    let temp = tempfile::tempdir().unwrap();
    let storage = LocalArtifactStore::new(temp.path());
    storage.ensure_layout().await.unwrap();
    let root = storage.artifact_path(release.artifact_digest());
    tokio::fs::create_dir_all(root.join("assets"))
        .await
        .unwrap();
    tokio::fs::create_dir_all(root.join("docs")).await.unwrap();
    tokio::fs::write(root.join("index.html"), b"home")
        .await
        .unwrap();
    tokio::fs::write(root.join("docs/index.html"), b"docs")
        .await
        .unwrap();
    tokio::fs::write(root.join("assets/app.js"), b"console.log('ready')")
        .await
        .unwrap();
    let service = PreviewService::new(Arc::new(StaticRepository { release }), storage);
    (build_router(service), temp, release_id)
}

fn entry(path: &str, contents: &[u8]) -> ManifestEntry {
    let byte = contents.len() % 16;
    ManifestEntry {
        path: path.to_owned(),
        size: contents.len() as u64,
        sha256: format!("{byte:x}").repeat(64),
    }
}
