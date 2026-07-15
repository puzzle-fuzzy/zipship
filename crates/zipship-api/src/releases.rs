use crate::{
    AppState,
    error::{ApiError, ErrorResponse},
    request::{authenticate, format_timestamp, no_store, parse_uuid},
};
use axum::{
    Json, Router,
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    routing::get,
};
use axum_extra::extract::CookieJar;
use serde::Serialize;
use serde_json::Value;
use utoipa::ToSchema;
use uuid::Uuid;
use zipship_artifact::{ArtifactManifest, ManifestEntry};
use zipship_domain::ProjectSlug;
use zipship_releases::{ProjectReleases, Release, ReleaseArtifact, ReleasesError};

#[derive(Debug, Serialize, ToSchema)]
pub(crate) struct ReleasesResponse {
    releases: Vec<ReleaseResponse>,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ReleaseResponse {
    id: Uuid,
    project_id: Uuid,
    version_number: u32,
    state: String,
    failure_code: Option<String>,
    artifact: Option<ReleaseArtifactResponse>,
    is_active: bool,
    preview_path: Option<String>,
    created_by: Uuid,
    created_at: String,
    ready_at: Option<String>,
    archived_at: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ReleaseArtifactResponse {
    sha256: String,
    file_count: u32,
    total_size: u64,
    manifest: ArtifactManifestResponse,
    #[schema(value_type = Object)]
    detect_report: Value,
}

#[derive(Debug, Serialize, ToSchema)]
pub(crate) struct ArtifactManifestResponse {
    version: u32,
    files: Vec<ManifestEntryResponse>,
}

#[derive(Debug, Serialize, ToSchema)]
pub(crate) struct ManifestEntryResponse {
    path: String,
    size: u64,
    sha256: String,
}

pub(crate) fn router() -> Router<AppState> {
    Router::new().route("/_api/projects/{project_id}/releases", get(list_releases))
}

#[utoipa::path(
    get,
    path = "/_api/projects/{project_id}/releases",
    tag = "releases",
    params(("project_id" = Uuid, Path, description = "Project ID")),
    responses(
        (status = 200, description = "Newest releases first", body = ReleasesResponse),
        (status = 401, description = "Session is absent or invalid", body = ErrorResponse),
        (status = 404, description = "Project does not exist or is not visible", body = ErrorResponse),
        (status = 503, description = "Release storage is unavailable", body = ErrorResponse)
    )
)]
pub(crate) async fn list_releases(
    State(state): State<AppState>,
    jar: CookieJar,
    Path(project_id): Path<String>,
) -> Result<impl IntoResponse, ApiError> {
    let session = authenticate(&state, &jar).await?;
    let project_id = parse_uuid(&project_id)?;
    let project = state.releases.list(session.user.id, project_id).await?;
    Ok(no_store(Json(ReleasesResponse::from(project))))
}

impl From<ReleasesError> for ApiError {
    fn from(error: ReleasesError) -> Self {
        let status = match error {
            ReleasesError::ProjectNotFound => StatusCode::NOT_FOUND,
            ReleasesError::Infrastructure => StatusCode::SERVICE_UNAVAILABLE,
        };
        Self::new(status, error.code())
    }
}

impl From<ProjectReleases> for ReleasesResponse {
    fn from(project: ProjectReleases) -> Self {
        Self {
            releases: project
                .releases
                .into_iter()
                .map(|release| ReleaseResponse::new(release, &project.project_slug))
                .collect(),
        }
    }
}

impl ReleaseResponse {
    fn new(release: Release, project_slug: &ProjectSlug) -> Self {
        let preview_path = (release.state == zipship_domain::ReleaseStatus::Ready
            && release.artifact.is_some())
        .then(|| format!("/_sites/{}/{}/", project_slug.as_str(), release.id));
        Self {
            id: release.id,
            project_id: release.project_id,
            version_number: release.version_number,
            state: release.state.as_str().to_owned(),
            failure_code: release.failure_code,
            artifact: release.artifact.map(Into::into),
            is_active: release.is_active,
            preview_path,
            created_by: release.created_by,
            created_at: format_timestamp(release.created_at),
            ready_at: release.ready_at.map(format_timestamp),
            archived_at: release.archived_at.map(format_timestamp),
        }
    }
}

impl From<ReleaseArtifact> for ReleaseArtifactResponse {
    fn from(artifact: ReleaseArtifact) -> Self {
        Self {
            sha256: artifact.digest.as_str().to_owned(),
            file_count: artifact.file_count,
            total_size: artifact.total_size,
            manifest: artifact.manifest.into(),
            detect_report: artifact.detect_report,
        }
    }
}

impl From<ArtifactManifest> for ArtifactManifestResponse {
    fn from(manifest: ArtifactManifest) -> Self {
        Self {
            version: manifest.version,
            files: manifest.files.into_iter().map(Into::into).collect(),
        }
    }
}

impl From<ManifestEntry> for ManifestEntryResponse {
    fn from(entry: ManifestEntry) -> Self {
        Self {
            path: entry.path,
            size: entry.size,
            sha256: entry.sha256,
        }
    }
}
