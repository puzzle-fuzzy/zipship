use async_trait::async_trait;
use serde_json::Value;
use sqlx::{FromRow, PgPool};
use std::str::FromStr;
use uuid::Uuid;
use zipship_artifact::ArtifactManifest;
use zipship_domain::{ArtifactDigest, ProjectSlug, ReleaseStatus};
use zipship_releases::{
    ProjectReleases, Release, ReleaseArtifact, ReleasesRepository, ReleasesRepositoryError,
};

#[derive(Clone)]
pub struct PgReleasesRepository {
    pool: PgPool,
}

impl PgReleasesRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl ReleasesRepository for PgReleasesRepository {
    async fn list_for_project(
        &self,
        project_id: Uuid,
        actor_id: Uuid,
    ) -> Result<ProjectReleases, ReleasesRepositoryError> {
        let mut transaction = self
            .pool
            .begin()
            .await
            .map_err(ReleasesRepositoryError::unavailable)?;
        let project_slug: String = sqlx::query_scalar(
            r#"
            SELECT projects.slug
            FROM projects
            INNER JOIN memberships
                ON memberships.organization_id = projects.organization_id
               AND memberships.user_id = $2
            WHERE projects.id = $1 AND projects.deleted_at IS NULL
            FOR SHARE OF projects, memberships
            "#,
        )
        .bind(project_id)
        .bind(actor_id)
        .fetch_optional(&mut *transaction)
        .await
        .map_err(ReleasesRepositoryError::unavailable)?
        .ok_or(ReleasesRepositoryError::ProjectNotFound)?;
        let project_slug = ProjectSlug::parse(project_slug).map_err(|_| corrupt_record())?;
        let rows = sqlx::query_as::<_, ReleaseRow>(
            r#"
            SELECT
                releases.id,
                releases.project_id,
                releases.version_number,
                releases.state,
                releases.failure_code,
                releases.created_by,
                releases.created_at,
                releases.ready_at,
                releases.archived_at,
                COALESCE(project_active_releases.release_id = releases.id, false) AS is_active,
                artifacts.id AS artifact_id,
                artifacts.sha256 AS artifact_sha256,
                artifacts.state AS artifact_state,
                artifacts.file_count AS artifact_file_count,
                artifacts.total_size AS artifact_total_size,
                artifacts.manifest AS artifact_manifest,
                artifacts.detect_report AS artifact_detect_report
            FROM releases
            LEFT JOIN project_active_releases
                ON project_active_releases.project_id = releases.project_id
            LEFT JOIN artifacts ON artifacts.id = releases.artifact_id
            WHERE releases.project_id = $1
            ORDER BY releases.version_number DESC
            "#,
        )
        .bind(project_id)
        .fetch_all(&mut *transaction)
        .await
        .map_err(ReleasesRepositoryError::unavailable)?;
        transaction
            .commit()
            .await
            .map_err(ReleasesRepositoryError::unavailable)?;
        let releases = rows
            .into_iter()
            .map(ReleaseRow::try_into_release)
            .collect::<Result<Vec<_>, _>>()?;
        Ok(ProjectReleases {
            project_slug,
            releases,
        })
    }
}

#[derive(Debug, FromRow)]
struct ReleaseRow {
    id: Uuid,
    project_id: Uuid,
    version_number: i32,
    state: String,
    failure_code: Option<String>,
    created_by: Uuid,
    created_at: time::OffsetDateTime,
    ready_at: Option<time::OffsetDateTime>,
    archived_at: Option<time::OffsetDateTime>,
    is_active: bool,
    artifact_id: Option<Uuid>,
    artifact_sha256: Option<String>,
    artifact_state: Option<String>,
    artifact_file_count: Option<i32>,
    artifact_total_size: Option<i64>,
    artifact_manifest: Option<Value>,
    artifact_detect_report: Option<Value>,
}

impl ReleaseRow {
    fn try_into_release(self) -> Result<Release, ReleasesRepositoryError> {
        let state = ReleaseStatus::from_str(&self.state).map_err(|_| corrupt_record())?;
        let artifact = self.try_into_artifact()?;
        if (state == ReleaseStatus::Ready && artifact.is_none())
            || (self.is_active && (state != ReleaseStatus::Ready || artifact.is_none()))
        {
            return Err(corrupt_record());
        }
        Ok(Release {
            id: self.id,
            project_id: self.project_id,
            version_number: u32::try_from(self.version_number).map_err(|_| corrupt_record())?,
            state,
            failure_code: self.failure_code,
            artifact,
            is_active: self.is_active,
            created_by: self.created_by,
            created_at: self.created_at,
            ready_at: self.ready_at,
            archived_at: self.archived_at,
        })
    }

    fn try_into_artifact(&self) -> Result<Option<ReleaseArtifact>, ReleasesRepositoryError> {
        let Some(_artifact_id) = self.artifact_id else {
            if self.artifact_sha256.is_some()
                || self.artifact_state.is_some()
                || self.artifact_file_count.is_some()
                || self.artifact_total_size.is_some()
                || self.artifact_manifest.is_some()
                || self.artifact_detect_report.is_some()
            {
                return Err(corrupt_record());
            }
            return Ok(None);
        };
        if self.artifact_state.as_deref() != Some("ready") {
            return Err(corrupt_record());
        }
        let digest =
            ArtifactDigest::parse(self.artifact_sha256.as_deref().ok_or_else(corrupt_record)?)
                .map_err(|_| corrupt_record())?;
        let file_count = u32::try_from(self.artifact_file_count.ok_or_else(corrupt_record)?)
            .map_err(|_| corrupt_record())?;
        let total_size = u64::try_from(self.artifact_total_size.ok_or_else(corrupt_record)?)
            .map_err(|_| corrupt_record())?;
        let manifest = serde_json::from_value::<ArtifactManifest>(
            self.artifact_manifest.clone().ok_or_else(corrupt_record)?,
        )
        .map_err(|_| corrupt_record())?;
        let detect_report = self
            .artifact_detect_report
            .clone()
            .ok_or_else(corrupt_record)?;
        Ok(Some(ReleaseArtifact {
            digest,
            file_count,
            total_size,
            manifest,
            detect_report,
        }))
    }
}

fn corrupt_record() -> ReleasesRepositoryError {
    ReleasesRepositoryError::unavailable(CorruptReleaseRecord)
}

#[derive(Debug)]
struct CorruptReleaseRecord;

impl std::fmt::Display for CorruptReleaseRecord {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("database returned an invalid release record")
    }
}

impl std::error::Error for CorruptReleaseRecord {}
