#![forbid(unsafe_code)]

use async_trait::async_trait;
use serde_json::Value;
use std::{error::Error as StdError, sync::Arc};
use thiserror::Error;
use time::OffsetDateTime;
use uuid::Uuid;
use zipship_artifact::ArtifactManifest;
use zipship_domain::{ArtifactDigest, ProjectSlug, ReleaseStatus};

#[derive(Debug, Clone, PartialEq)]
pub struct ReleaseArtifact {
    pub digest: ArtifactDigest,
    pub file_count: u32,
    pub total_size: u64,
    pub manifest: ArtifactManifest,
    pub detect_report: Value,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Release {
    pub id: Uuid,
    pub project_id: Uuid,
    pub version_number: u32,
    pub state: ReleaseStatus,
    pub failure_code: Option<String>,
    pub artifact: Option<ReleaseArtifact>,
    pub is_active: bool,
    pub created_by: Uuid,
    pub created_at: OffsetDateTime,
    pub ready_at: Option<OffsetDateTime>,
    pub archived_at: Option<OffsetDateTime>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ProjectReleases {
    pub project_slug: ProjectSlug,
    pub releases: Vec<Release>,
}

#[derive(Debug, Error)]
pub enum ReleasesRepositoryError {
    #[error("project was not found or is not visible")]
    ProjectNotFound,
    #[error("releases repository is unavailable")]
    Unavailable {
        #[source]
        source: Box<dyn StdError + Send + Sync>,
    },
}

impl ReleasesRepositoryError {
    pub fn unavailable(source: impl StdError + Send + Sync + 'static) -> Self {
        Self::Unavailable {
            source: Box::new(source),
        }
    }
}

#[async_trait]
pub trait ReleasesRepository: Send + Sync + 'static {
    async fn list_for_project(
        &self,
        project_id: Uuid,
        actor_id: Uuid,
    ) -> Result<ProjectReleases, ReleasesRepositoryError>;
}

#[derive(Debug, Error, Clone, Copy, PartialEq, Eq)]
pub enum ReleasesError {
    #[error("project was not found or is not visible")]
    ProjectNotFound,
    #[error("releases infrastructure failed")]
    Infrastructure,
}

impl ReleasesError {
    pub const fn code(self) -> &'static str {
        match self {
            Self::ProjectNotFound => "PROJECT_NOT_FOUND",
            Self::Infrastructure => "RELEASES_INFRASTRUCTURE_FAILURE",
        }
    }
}

#[derive(Clone)]
pub struct ReleasesService {
    repository: Arc<dyn ReleasesRepository>,
}

impl ReleasesService {
    pub fn new(repository: Arc<dyn ReleasesRepository>) -> Self {
        Self { repository }
    }

    pub async fn list(
        &self,
        actor_id: Uuid,
        project_id: Uuid,
    ) -> Result<ProjectReleases, ReleasesError> {
        self.repository
            .list_for_project(project_id, actor_id)
            .await
            .map_err(|error| match error {
                ReleasesRepositoryError::ProjectNotFound => ReleasesError::ProjectNotFound,
                ReleasesRepositoryError::Unavailable { .. } => ReleasesError::Infrastructure,
            })
    }
}

#[cfg(test)]
mod tests;
