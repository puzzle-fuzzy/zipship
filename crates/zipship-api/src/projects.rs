use super::AppState;
use crate::{
    error::{ApiError, ErrorResponse},
    request::{authenticate, format_timestamp, no_store, parse_uuid, require_csrf},
};
use axum::{
    Json, Router,
    extract::{Path, State, rejection::JsonRejection},
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    routing::get,
};
use axum_extra::extract::CookieJar;
use serde::{Deserialize, Deserializer, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;
use zipship_projects::{
    CreateProjectCommand, OrganizationSummary, Project, ProjectsError, UpdateProjectCommand,
};

#[derive(Debug, Serialize, ToSchema)]
pub(crate) struct OrganizationsResponse {
    organizations: Vec<OrganizationResponse>,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OrganizationResponse {
    id: Uuid,
    name: String,
    slug: String,
    role: String,
    created_at: String,
}

#[derive(Debug, Deserialize, ToSchema)]
pub(crate) struct CreateProjectRequest {
    name: String,
    slug: String,
    description: Option<String>,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdateProjectRequest {
    #[serde(default, deserialize_with = "deserialize_present_field")]
    #[schema(nullable = false)]
    name: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_present_field")]
    #[schema(nullable = false)]
    slug: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_present_field")]
    description: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_present_field")]
    #[schema(nullable = false)]
    spa_fallback: Option<Option<bool>>,
    #[serde(default, deserialize_with = "deserialize_present_field")]
    #[schema(nullable = false)]
    cache_policy: Option<Option<ProjectCachePolicyRequest>>,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub(crate) enum ProjectCachePolicyRequest {
    Standard,
    Aggressive,
}

impl ProjectCachePolicyRequest {
    const fn as_str(&self) -> &'static str {
        match self {
            Self::Standard => "standard",
            Self::Aggressive => "aggressive",
        }
    }
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProjectResponse {
    id: Uuid,
    organization_id: Uuid,
    name: String,
    slug: String,
    description: Option<String>,
    spa_fallback: bool,
    cache_policy: String,
    active_release_id: Option<Uuid>,
    created_by: Uuid,
    created_at: String,
    updated_at: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub(crate) struct ProjectEnvelope {
    project: ProjectResponse,
}

#[derive(Debug, Serialize, ToSchema)]
pub(crate) struct ProjectsResponse {
    projects: Vec<ProjectResponse>,
}

pub(crate) fn router() -> Router<AppState> {
    Router::new()
        .route("/_api/organizations", get(list_organizations))
        .route(
            "/_api/organizations/{organization_id}/projects",
            get(list_projects).post(create_project),
        )
        .route(
            "/_api/projects/{project_id}",
            get(get_project).patch(update_project),
        )
}

#[utoipa::path(
    get,
    path = "/_api/organizations",
    tag = "organizations",
    responses(
        (status = 200, description = "Organizations visible to the current user", body = OrganizationsResponse),
        (status = 401, description = "Session is absent or invalid", body = ErrorResponse),
        (status = 503, description = "Organization storage is unavailable", body = ErrorResponse)
    )
)]
pub(crate) async fn list_organizations(
    State(state): State<AppState>,
    jar: CookieJar,
) -> Result<impl IntoResponse, ApiError> {
    let session = authenticate(&state, &jar).await?;
    let organizations = state
        .projects
        .list_organizations(session.user.id)
        .await?
        .into_iter()
        .map(Into::into)
        .collect();
    Ok(no_store(Json(OrganizationsResponse { organizations })))
}

#[utoipa::path(
    get,
    path = "/_api/organizations/{organization_id}/projects",
    tag = "projects",
    params(("organization_id" = Uuid, Path, description = "Organization ID")),
    responses(
        (status = 200, description = "Projects in the organization", body = ProjectsResponse),
        (status = 400, description = "Path parameter is invalid", body = ErrorResponse),
        (status = 401, description = "Session is absent or invalid", body = ErrorResponse),
        (status = 403, description = "Current user is not a member", body = ErrorResponse),
        (status = 503, description = "Project storage is unavailable", body = ErrorResponse)
    )
)]
pub(crate) async fn list_projects(
    State(state): State<AppState>,
    jar: CookieJar,
    Path(organization_id): Path<String>,
) -> Result<impl IntoResponse, ApiError> {
    let session = authenticate(&state, &jar).await?;
    let organization_id = parse_uuid(&organization_id)?;
    let projects = state
        .projects
        .list_projects(session.user.id, organization_id)
        .await?
        .into_iter()
        .map(Into::into)
        .collect();
    Ok(no_store(Json(ProjectsResponse { projects })))
}

#[utoipa::path(
    post,
    path = "/_api/organizations/{organization_id}/projects",
    tag = "projects",
    params(
        ("organization_id" = Uuid, Path, description = "Organization ID"),
        ("x-csrf-token" = String, Header, description = "CSRF token issued with the session")
    ),
    request_body = CreateProjectRequest,
    responses(
        (status = 201, description = "Project created", body = ProjectEnvelope),
        (status = 400, description = "JSON or path parameter is invalid", body = ErrorResponse),
        (status = 401, description = "Session is absent or invalid", body = ErrorResponse),
        (status = 403, description = "Current role cannot create projects", body = ErrorResponse),
        (status = 409, description = "Project slug already exists", body = ErrorResponse),
        (status = 422, description = "Project input is invalid", body = ErrorResponse),
        (status = 503, description = "Project storage is unavailable", body = ErrorResponse)
    )
)]
pub(crate) async fn create_project(
    State(state): State<AppState>,
    jar: CookieJar,
    headers: HeaderMap,
    Path(organization_id): Path<String>,
    payload: Result<Json<CreateProjectRequest>, JsonRejection>,
) -> Result<impl IntoResponse, ApiError> {
    let session = authenticate(&state, &jar).await?;
    require_csrf(&state, &session, &headers)?;
    let organization_id = parse_uuid(&organization_id)?;
    let Json(payload) = payload.map_err(|_| ApiError::invalid_json())?;
    let project = state
        .projects
        .create_project(CreateProjectCommand {
            actor_id: session.user.id,
            organization_id,
            name: payload.name,
            slug: payload.slug,
            description: payload.description,
        })
        .await?;
    Ok((
        StatusCode::CREATED,
        no_store(Json(ProjectEnvelope {
            project: project.into(),
        })),
    ))
}

#[utoipa::path(
    get,
    path = "/_api/projects/{project_id}",
    tag = "projects",
    params(("project_id" = Uuid, Path, description = "Project ID")),
    responses(
        (status = 200, description = "Project visible to the current user", body = ProjectEnvelope),
        (status = 400, description = "Path parameter is invalid", body = ErrorResponse),
        (status = 401, description = "Session is absent or invalid", body = ErrorResponse),
        (status = 404, description = "Project is missing or not visible", body = ErrorResponse),
        (status = 503, description = "Project storage is unavailable", body = ErrorResponse)
    )
)]
pub(crate) async fn get_project(
    State(state): State<AppState>,
    jar: CookieJar,
    Path(project_id): Path<String>,
) -> Result<impl IntoResponse, ApiError> {
    let session = authenticate(&state, &jar).await?;
    let project_id = parse_uuid(&project_id)?;
    let project = state
        .projects
        .get_project(session.user.id, project_id)
        .await?;
    Ok(no_store(Json(ProjectEnvelope {
        project: project.into(),
    })))
}

#[utoipa::path(
    patch,
    path = "/_api/projects/{project_id}",
    tag = "projects",
    params(
        ("project_id" = Uuid, Path, description = "Project ID"),
        ("x-csrf-token" = String, Header, description = "CSRF token issued with the session")
    ),
    request_body = UpdateProjectRequest,
    responses(
        (status = 200, description = "Updated project settings", body = ProjectEnvelope),
        (status = 400, description = "JSON or path parameter is invalid", body = ErrorResponse),
        (status = 401, description = "Session is absent or invalid", body = ErrorResponse),
        (status = 403, description = "Current role cannot manage this project", body = ErrorResponse),
        (status = 404, description = "Project is missing or not visible", body = ErrorResponse),
        (status = 409, description = "Project slug already exists", body = ErrorResponse),
        (status = 422, description = "Project settings are invalid or empty", body = ErrorResponse),
        (status = 503, description = "Project storage is unavailable", body = ErrorResponse)
    )
)]
pub(crate) async fn update_project(
    State(state): State<AppState>,
    jar: CookieJar,
    headers: HeaderMap,
    Path(project_id): Path<String>,
    payload: Result<Json<UpdateProjectRequest>, JsonRejection>,
) -> Result<impl IntoResponse, ApiError> {
    let session = authenticate(&state, &jar).await?;
    require_csrf(&state, &session, &headers)?;
    let project_id = parse_uuid(&project_id)?;
    let Json(payload) = payload.map_err(|_| ApiError::invalid_json())?;
    let name = require_non_null_patch(payload.name)?;
    let slug = require_non_null_patch(payload.slug)?;
    let spa_fallback = require_non_null_patch(payload.spa_fallback)?;
    let cache_policy =
        require_non_null_patch(payload.cache_policy)?.map(|policy| policy.as_str().to_owned());
    let project = state
        .projects
        .update_project(UpdateProjectCommand {
            actor_id: session.user.id,
            project_id,
            name,
            slug,
            description: payload.description,
            spa_fallback,
            cache_policy,
        })
        .await?;
    Ok(no_store(Json(ProjectEnvelope {
        project: project.into(),
    })))
}

impl From<ProjectsError> for ApiError {
    fn from(error: ProjectsError) -> Self {
        let status = match error {
            ProjectsError::InvalidInput => StatusCode::UNPROCESSABLE_ENTITY,
            ProjectsError::Forbidden => StatusCode::FORBIDDEN,
            ProjectsError::NotFound => StatusCode::NOT_FOUND,
            ProjectsError::DuplicateSlug => StatusCode::CONFLICT,
            ProjectsError::Infrastructure => StatusCode::SERVICE_UNAVAILABLE,
        };
        Self::new(status, error.code())
    }
}

impl From<OrganizationSummary> for OrganizationResponse {
    fn from(organization: OrganizationSummary) -> Self {
        Self {
            id: organization.id,
            name: organization.name,
            slug: organization.slug,
            role: organization.role.as_str().to_owned(),
            created_at: format_timestamp(organization.created_at),
        }
    }
}

impl From<Project> for ProjectResponse {
    fn from(project: Project) -> Self {
        Self {
            id: project.id,
            organization_id: project.organization_id,
            name: project.name,
            slug: project.slug,
            description: project.description,
            spa_fallback: project.spa_fallback,
            cache_policy: project.cache_policy.as_str().to_owned(),
            active_release_id: project.active_release_id,
            created_by: project.created_by,
            created_at: format_timestamp(project.created_at),
            updated_at: format_timestamp(project.updated_at),
        }
    }
}

fn deserialize_present_field<'de, D, T>(deserializer: D) -> Result<Option<Option<T>>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(deserializer).map(Some)
}

fn require_non_null_patch<T>(value: Option<Option<T>>) -> Result<Option<T>, ApiError> {
    match value {
        Some(Some(value)) => Ok(Some(value)),
        Some(None) => Err(ApiError::new(
            StatusCode::UNPROCESSABLE_ENTITY,
            ProjectsError::InvalidInput.code(),
        )),
        None => Ok(None),
    }
}
