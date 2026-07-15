use crate::{
    AppState,
    error::{ApiError, ErrorResponse},
    request::{authenticate, format_timestamp, no_store, parse_uuid, require_csrf},
};
use axum::{
    Json, Router,
    extract::{Path, State, rejection::JsonRejection},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use axum_extra::extract::CookieJar;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;
use zipship_deployments::{Deployment, DeploymentRequest, DeploymentResult, DeploymentsError};

const IDEMPOTENCY_KEY_HEADER: &str = "idempotency-key";
const REQUEST_ID_HEADER: &str = "x-request-id";

#[derive(Debug, Default, Deserialize, ToSchema)]
pub(crate) struct DeploymentMessageRequest {
    message: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DeploymentEnvelope {
    deployment: DeploymentResponse,
    active_release_id: Uuid,
    replayed: bool,
}

#[derive(Debug, Serialize, ToSchema)]
pub(crate) struct DeploymentsResponse {
    deployments: Vec<DeploymentResponse>,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DeploymentResponse {
    id: Uuid,
    project_id: Uuid,
    release_id: Uuid,
    previous_release_id: Option<Uuid>,
    action: String,
    status: String,
    actor_id: Uuid,
    message: Option<String>,
    created_at: String,
    finished_at: String,
}

pub(crate) fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/_api/projects/{project_id}/releases/{release_id}/publish",
            post(publish),
        )
        .route(
            "/_api/projects/{project_id}/releases/{release_id}/rollback",
            post(rollback),
        )
        .route(
            "/_api/projects/{project_id}/deployments",
            get(list_deployments),
        )
}

#[utoipa::path(
    post,
    path = "/_api/projects/{project_id}/releases/{release_id}/publish",
    tag = "deployments",
    params(
        ("project_id" = Uuid, Path, description = "Project ID"),
        ("release_id" = Uuid, Path, description = "Ready release to activate"),
        ("idempotency-key" = String, Header, description = "Unique visible-ASCII operation key, up to 128 bytes"),
        ("x-csrf-token" = String, Header, description = "CSRF token issued with the session")
    ),
    request_body = DeploymentMessageRequest,
    responses(
        (status = 200, description = "Release activated or the same request replayed", body = DeploymentEnvelope),
        (status = 401, description = "Session is absent or invalid", body = ErrorResponse),
        (status = 403, description = "Current role cannot publish releases", body = ErrorResponse),
        (status = 404, description = "Project or release does not exist", body = ErrorResponse),
        (status = 409, description = "Release state or idempotency key conflicts", body = ErrorResponse),
        (status = 422, description = "Idempotency key or message is invalid", body = ErrorResponse),
        (status = 503, description = "Deployment storage is unavailable", body = ErrorResponse)
    )
)]
pub(crate) async fn publish(
    State(state): State<AppState>,
    jar: CookieJar,
    headers: HeaderMap,
    Path((project_id, release_id)): Path<(String, String)>,
    payload: Result<Json<DeploymentMessageRequest>, JsonRejection>,
) -> Result<Response, ApiError> {
    execute(
        &state,
        &jar,
        &headers,
        &project_id,
        &release_id,
        payload,
        false,
    )
    .await
}

#[utoipa::path(
    post,
    path = "/_api/projects/{project_id}/releases/{release_id}/rollback",
    tag = "deployments",
    params(
        ("project_id" = Uuid, Path, description = "Project ID"),
        ("release_id" = Uuid, Path, description = "Previously active release to restore"),
        ("idempotency-key" = String, Header, description = "Unique visible-ASCII operation key, up to 128 bytes"),
        ("x-csrf-token" = String, Header, description = "CSRF token issued with the session")
    ),
    request_body = DeploymentMessageRequest,
    responses(
        (status = 200, description = "Release restored or the same request replayed", body = DeploymentEnvelope),
        (status = 401, description = "Session is absent or invalid", body = ErrorResponse),
        (status = 403, description = "Current role cannot roll releases back", body = ErrorResponse),
        (status = 404, description = "Project or release does not exist", body = ErrorResponse),
        (status = 409, description = "Release is not a valid rollback target or idempotency key conflicts", body = ErrorResponse),
        (status = 422, description = "Idempotency key or message is invalid", body = ErrorResponse),
        (status = 503, description = "Deployment storage is unavailable", body = ErrorResponse)
    )
)]
pub(crate) async fn rollback(
    State(state): State<AppState>,
    jar: CookieJar,
    headers: HeaderMap,
    Path((project_id, release_id)): Path<(String, String)>,
    payload: Result<Json<DeploymentMessageRequest>, JsonRejection>,
) -> Result<impl IntoResponse, ApiError> {
    execute(
        &state,
        &jar,
        &headers,
        &project_id,
        &release_id,
        payload,
        true,
    )
    .await
}

#[utoipa::path(
    get,
    path = "/_api/projects/{project_id}/deployments",
    tag = "deployments",
    params(("project_id" = Uuid, Path, description = "Project ID")),
    responses(
        (status = 200, description = "Newest deployments first", body = DeploymentsResponse),
        (status = 401, description = "Session is absent or invalid", body = ErrorResponse),
        (status = 403, description = "Current member cannot view this project", body = ErrorResponse),
        (status = 404, description = "Project does not exist", body = ErrorResponse),
        (status = 503, description = "Deployment storage is unavailable", body = ErrorResponse)
    )
)]
pub(crate) async fn list_deployments(
    State(state): State<AppState>,
    jar: CookieJar,
    Path(project_id): Path<String>,
) -> Result<impl IntoResponse, ApiError> {
    let session = authenticate(&state, &jar).await?;
    let project_id = parse_uuid(&project_id)?;
    let deployments = state
        .deployments
        .list(session.user.id, project_id)
        .await?
        .into_iter()
        .map(Into::into)
        .collect();
    Ok(no_store(Json(DeploymentsResponse { deployments })))
}

async fn execute(
    state: &AppState,
    jar: &CookieJar,
    headers: &HeaderMap,
    project_id: &str,
    release_id: &str,
    payload: Result<Json<DeploymentMessageRequest>, JsonRejection>,
    rollback: bool,
) -> Result<Response, ApiError> {
    let session = authenticate(state, jar).await?;
    require_csrf(state, &session, headers)?;
    let project_id = parse_uuid(project_id)?;
    let release_id = parse_uuid(release_id)?;
    let idempotency_key = headers
        .get(IDEMPOTENCY_KEY_HEADER)
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned)
        .ok_or_else(|| {
            ApiError::new(StatusCode::UNPROCESSABLE_ENTITY, "INVALID_DEPLOYMENT_INPUT")
        })?;
    let Json(payload) = payload.map_err(|_| ApiError::invalid_json())?;
    let request = DeploymentRequest {
        project_id,
        release_id,
        actor_id: session.user.id,
        idempotency_key,
        message: payload.message,
        request_id: headers
            .get(REQUEST_ID_HEADER)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| Uuid::parse_str(value).ok()),
    };
    let result = if rollback {
        state.deployments.rollback(request).await?
    } else {
        state.deployments.publish(request).await?
    };
    Ok(no_store(Json(DeploymentEnvelope::from(result))).into_response())
}

impl From<DeploymentsError> for ApiError {
    fn from(error: DeploymentsError) -> Self {
        let status = match error {
            DeploymentsError::InvalidInput => StatusCode::UNPROCESSABLE_ENTITY,
            DeploymentsError::Forbidden => StatusCode::FORBIDDEN,
            DeploymentsError::ProjectNotFound | DeploymentsError::ReleaseNotFound => {
                StatusCode::NOT_FOUND
            }
            DeploymentsError::ReleaseNotReady
            | DeploymentsError::ReleaseAlreadyActive
            | DeploymentsError::ReleaseNotRollbackable
            | DeploymentsError::IdempotencyConflict => StatusCode::CONFLICT,
            DeploymentsError::Infrastructure => StatusCode::SERVICE_UNAVAILABLE,
        };
        Self::new(status, error.code())
    }
}

impl From<DeploymentResult> for DeploymentEnvelope {
    fn from(result: DeploymentResult) -> Self {
        Self {
            deployment: result.deployment.into(),
            active_release_id: result.active_release_id,
            replayed: result.replayed,
        }
    }
}

impl From<Deployment> for DeploymentResponse {
    fn from(deployment: Deployment) -> Self {
        Self {
            id: deployment.id,
            project_id: deployment.project_id,
            release_id: deployment.release_id,
            previous_release_id: deployment.previous_release_id,
            action: deployment.action.as_str().to_owned(),
            status: deployment.status.as_str().to_owned(),
            actor_id: deployment.actor_id,
            message: deployment.message,
            created_at: format_timestamp(deployment.created_at),
            finished_at: format_timestamp(deployment.finished_at),
        }
    }
}
