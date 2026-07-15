use super::AppState;
use crate::{
    error::{ApiError, ErrorResponse},
    request::{authenticate, format_timestamp, no_store, parse_uuid},
};
use axum::{
    Json, Router,
    extract::{Path, Query, State, rejection::QueryRejection},
    http::StatusCode,
    response::IntoResponse,
    routing::get,
};
use axum_extra::extract::CookieJar;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use utoipa::ToSchema;
use uuid::Uuid;
use zipship_audit::{AuditActor, AuditEntry, AuditError, ListAuditCommand};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ListAuditQuery {
    limit: Option<u16>,
    cursor: Option<Uuid>,
    project_id: Option<Uuid>,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AuditLogsResponse {
    items: Vec<AuditEntryResponse>,
    next_cursor: Option<Uuid>,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AuditEntryResponse {
    id: Uuid,
    organization_id: Uuid,
    project_id: Option<Uuid>,
    actor: Option<AuditActorResponse>,
    action: String,
    target_type: String,
    target_id: Option<Uuid>,
    request_id: Option<Uuid>,
    #[schema(value_type = Object)]
    metadata: Value,
    created_at: String,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AuditActorResponse {
    id: Uuid,
    email: String,
    display_name: String,
}

pub(crate) fn router() -> Router<AppState> {
    Router::new().route(
        "/_api/organizations/{organization_id}/audit-logs",
        get(list_audit_logs),
    )
}

#[utoipa::path(
    get,
    path = "/_api/organizations/{organization_id}/audit-logs",
    tag = "audit",
    params(
        ("organization_id" = Uuid, Path, description = "Organization ID"),
        (
            "limit" = Option<u16>,
            Query,
            description = "Page size from 1 through 100",
            minimum = 1,
            maximum = 100
        ),
        ("cursor" = Option<Uuid>, Query, description = "Last entry ID from the previous page"),
        ("projectId" = Option<Uuid>, Query, description = "Restrict entries to one project")
    ),
    responses(
        (status = 200, description = "Newest organization audit entries", body = AuditLogsResponse),
        (status = 401, description = "Session is absent or invalid", body = ErrorResponse),
        (status = 404, description = "Organization is missing or not visible", body = ErrorResponse),
        (status = 422, description = "Query or cursor is invalid", body = ErrorResponse),
        (status = 503, description = "Audit storage is unavailable", body = ErrorResponse)
    )
)]
pub(crate) async fn list_audit_logs(
    State(state): State<AppState>,
    jar: CookieJar,
    Path(organization_id): Path<String>,
    query: Result<Query<ListAuditQuery>, QueryRejection>,
) -> Result<impl IntoResponse, ApiError> {
    let session = authenticate(&state, &jar).await?;
    let organization_id = parse_uuid(&organization_id)?;
    let Query(query) = query.map_err(|_| invalid_query())?;
    let page = state
        .audit
        .list(ListAuditCommand {
            actor_id: session.user.id,
            organization_id,
            project_id: query.project_id,
            cursor: query.cursor,
            limit: query.limit,
        })
        .await?;
    Ok(no_store(Json(AuditLogsResponse {
        items: page.entries.into_iter().map(Into::into).collect(),
        next_cursor: page.next_cursor,
    })))
}

impl From<AuditError> for ApiError {
    fn from(error: AuditError) -> Self {
        let status = match error {
            AuditError::InvalidQuery | AuditError::InvalidCursor => {
                StatusCode::UNPROCESSABLE_ENTITY
            }
            AuditError::OrganizationNotFound => StatusCode::NOT_FOUND,
            AuditError::Infrastructure => StatusCode::SERVICE_UNAVAILABLE,
        };
        Self::new(status, error.code())
    }
}

impl From<AuditEntry> for AuditEntryResponse {
    fn from(entry: AuditEntry) -> Self {
        Self {
            id: entry.id,
            organization_id: entry.organization_id,
            project_id: entry.project_id,
            actor: entry.actor.map(Into::into),
            action: entry.action,
            target_type: entry.target_type,
            target_id: entry.target_id,
            request_id: entry.request_id,
            metadata: entry.metadata,
            created_at: format_timestamp(entry.created_at),
        }
    }
}

impl From<AuditActor> for AuditActorResponse {
    fn from(actor: AuditActor) -> Self {
        Self {
            id: actor.id,
            email: actor.email,
            display_name: actor.display_name,
        }
    }
}

fn invalid_query() -> ApiError {
    ApiError::new(
        StatusCode::UNPROCESSABLE_ENTITY,
        AuditError::InvalidQuery.code(),
    )
}
