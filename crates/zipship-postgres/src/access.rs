use async_trait::async_trait;
use serde_json::Value;
use sqlx::{FromRow, PgPool};
use std::str::FromStr;
use uuid::Uuid;
use zipship_access::{PreviewRelease, PreviewRepository, PreviewRepositoryError};
use zipship_artifact::ArtifactManifest;
use zipship_domain::{ArtifactDigest, CachePolicy, ProjectSlug};

#[derive(Clone)]
pub struct PgPreviewRepository {
    pool: PgPool,
}

impl PgPreviewRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl PreviewRepository for PgPreviewRepository {
    async fn find_ready_release(
        &self,
        project_slug: &ProjectSlug,
        release_id: Uuid,
    ) -> Result<Option<PreviewRelease>, PreviewRepositoryError> {
        let row = sqlx::query_as::<_, PreviewRow>(
            r#"
            SELECT
                releases.id AS release_id,
                projects.slug AS project_slug,
                projects.spa_fallback,
                projects.cache_policy,
                artifacts.sha256,
                artifacts.storage_key,
                artifacts.file_count,
                artifacts.total_size,
                artifacts.manifest
            FROM releases
            INNER JOIN projects ON projects.id = releases.project_id
            INNER JOIN artifacts ON artifacts.id = releases.artifact_id
            WHERE projects.slug = $1
              AND projects.deleted_at IS NULL
              AND releases.id = $2
              AND releases.state = 'ready'
              AND artifacts.state = 'ready'
            "#,
        )
        .bind(project_slug.as_str())
        .bind(release_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(PreviewRepositoryError::unavailable)?;

        row.map(PreviewRow::try_into_release).transpose()
    }

    async fn find_active_release(
        &self,
        project_slug: &ProjectSlug,
    ) -> Result<Option<PreviewRelease>, PreviewRepositoryError> {
        let row = sqlx::query_as::<_, PreviewRow>(
            r#"
            SELECT
                releases.id AS release_id,
                projects.slug AS project_slug,
                projects.spa_fallback,
                projects.cache_policy,
                artifacts.sha256,
                artifacts.storage_key,
                artifacts.file_count,
                artifacts.total_size,
                artifacts.manifest
            FROM project_active_releases
            INNER JOIN projects ON projects.id = project_active_releases.project_id
            INNER JOIN releases
                ON releases.id = project_active_releases.release_id
               AND releases.project_id = projects.id
            INNER JOIN artifacts ON artifacts.id = releases.artifact_id
            WHERE projects.slug = $1
              AND projects.deleted_at IS NULL
              AND releases.state = 'ready'
              AND artifacts.state = 'ready'
            "#,
        )
        .bind(project_slug.as_str())
        .fetch_optional(&self.pool)
        .await
        .map_err(PreviewRepositoryError::unavailable)?;

        row.map(PreviewRow::try_into_release).transpose()
    }
}

#[derive(Debug, FromRow)]
struct PreviewRow {
    release_id: Uuid,
    project_slug: String,
    spa_fallback: bool,
    cache_policy: String,
    sha256: String,
    storage_key: String,
    file_count: i32,
    total_size: i64,
    manifest: Value,
}

impl PreviewRow {
    fn try_into_release(self) -> Result<PreviewRelease, PreviewRepositoryError> {
        let project_slug = ProjectSlug::parse(self.project_slug)
            .map_err(|_| PreviewRepositoryError::CorruptRecord)?;
        let cache_policy = CachePolicy::from_str(&self.cache_policy)
            .map_err(|_| PreviewRepositoryError::CorruptRecord)?;
        let artifact_digest = ArtifactDigest::parse(self.sha256)
            .map_err(|_| PreviewRepositoryError::CorruptRecord)?;
        let file_count =
            u32::try_from(self.file_count).map_err(|_| PreviewRepositoryError::CorruptRecord)?;
        let total_size =
            u64::try_from(self.total_size).map_err(|_| PreviewRepositoryError::CorruptRecord)?;
        let manifest: ArtifactManifest = serde_json::from_value(self.manifest)
            .map_err(|_| PreviewRepositoryError::CorruptRecord)?;

        PreviewRelease::try_new(
            self.release_id,
            project_slug,
            artifact_digest,
            &self.storage_key,
            cache_policy,
            self.spa_fallback,
            file_count,
            total_size,
            manifest,
        )
        .map_err(|_| PreviewRepositoryError::CorruptRecord)
    }
}
