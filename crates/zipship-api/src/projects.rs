use super::AppState;
use crate::{
    auth,
    error::{ApiError, ErrorResponse},
};
use axum::{
    Json, Router,
    extract::{Path, State, rejection::JsonRejection},
    http::{HeaderMap, HeaderValue, StatusCode, header},
    response::IntoResponse,
    routing::get,
};
use axum_extra::extract::CookieJar;
use serde::{Deserialize, Serialize};
use time::{OffsetDateTime, format_description::well_known::Rfc3339};
use utoipa::ToSchema;
use uuid::Uuid;
use zipship_projects::{
    CreateProjectCommand, MemberSummary, OrganizationSummary, Project, ProjectsError,
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

#[derive(Debug, Serialize, ToSchema)]
pub(crate) struct MembersResponse {
    members: Vec<MemberResponse>,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MemberResponse {
    user_id: Uuid,
    email: String,
    display_name: String,
    role: String,
    joined_at: String,
}

#[derive(Debug, Deserialize, ToSchema)]
pub(crate) struct CreateProjectRequest {
    name: String,
    slug: String,
    description: Option<String>,
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
            "/_api/organizations/{organization_id}/members",
            get(list_members),
        )
        .route(
            "/_api/organizations/{organization_id}/projects",
            get(list_projects).post(create_project),
        )
        .route("/_api/projects/{project_id}", get(get_project))
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
    path = "/_api/organizations/{organization_id}/members",
    tag = "organizations",
    params(("organization_id" = Uuid, Path, description = "Organization ID")),
    responses(
        (status = 200, description = "Organization members", body = MembersResponse),
        (status = 400, description = "Path parameter is invalid", body = ErrorResponse),
        (status = 401, description = "Session is absent or invalid", body = ErrorResponse),
        (status = 403, description = "Current user is not a member", body = ErrorResponse),
        (status = 503, description = "Membership storage is unavailable", body = ErrorResponse)
    )
)]
pub(crate) async fn list_members(
    State(state): State<AppState>,
    jar: CookieJar,
    Path(organization_id): Path<String>,
) -> Result<impl IntoResponse, ApiError> {
    let session = authenticate(&state, &jar).await?;
    let organization_id = parse_uuid(&organization_id)?;
    let members = state
        .projects
        .list_members(session.user.id, organization_id)
        .await?
        .into_iter()
        .map(Into::into)
        .collect();
    Ok(no_store(Json(MembersResponse { members })))
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

async fn authenticate(
    state: &AppState,
    jar: &CookieJar,
) -> Result<zipship_auth::ResolvedSession, ApiError> {
    let token = auth::session_token(jar)?;
    state.auth.authenticate(token).await.map_err(Into::into)
}

fn require_csrf(
    state: &AppState,
    session: &zipship_auth::ResolvedSession,
    headers: &HeaderMap,
) -> Result<(), ApiError> {
    let csrf = headers
        .get(auth::CSRF_HEADER)
        .and_then(|value| value.to_str().ok())
        .ok_or_else(|| ApiError::new(StatusCode::FORBIDDEN, "INVALID_CSRF_TOKEN"))?;
    state.auth.verify_csrf(session, csrf).map_err(Into::into)
}

fn parse_uuid(value: &str) -> Result<Uuid, ApiError> {
    Uuid::parse_str(value).map_err(|_| ApiError::invalid_path_parameter())
}

fn no_store<T>(body: Json<T>) -> ([(header::HeaderName, HeaderValue); 1], Json<T>) {
    (
        [(header::CACHE_CONTROL, HeaderValue::from_static("no-store"))],
        body,
    )
}

fn format_timestamp(value: OffsetDateTime) -> String {
    value
        .format(&Rfc3339)
        .expect("OffsetDateTime must be representable as RFC 3339")
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

impl From<MemberSummary> for MemberResponse {
    fn from(member: MemberSummary) -> Self {
        Self {
            user_id: member.user_id,
            email: member.email,
            display_name: member.display_name,
            role: member.role.as_str().to_owned(),
            joined_at: format_timestamp(member.joined_at),
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
