use super::AppState;
use crate::error::{ApiError, ErrorResponse};
use crate::request::{authenticate, format_timestamp, no_store, parse_uuid, require_csrf};
use axum::{
    Json, Router,
    extract::{Path, State, rejection::JsonRejection},
    http::{HeaderMap, HeaderValue, StatusCode, header},
    response::IntoResponse,
    routing::{get, patch},
};
use axum_extra::extract::CookieJar;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;
use zipship_domain::MemberRole;
use zipship_members::{Member, MembersError, RemoveMemberCommand, UpdateMemberRoleCommand};

#[derive(Debug, Serialize, ToSchema)]
pub(crate) struct MembersResponse {
    members: Vec<MemberResponse>,
}

#[derive(Debug, Serialize, ToSchema)]
pub(crate) struct MemberEnvelope {
    member: MemberResponse,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MemberResponse {
    user_id: Uuid,
    email: String,
    display_name: String,
    role: MemberRoleDto,
    joined_at: String,
}

#[derive(Debug, Deserialize, ToSchema)]
pub(crate) struct UpdateMemberRoleRequest {
    role: MemberRoleDto,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub(crate) enum MemberRoleDto {
    Owner,
    Admin,
    Developer,
    Deployer,
    Viewer,
}

impl MemberRoleDto {
    pub(crate) const fn as_str(&self) -> &'static str {
        match self {
            Self::Owner => "owner",
            Self::Admin => "admin",
            Self::Developer => "developer",
            Self::Deployer => "deployer",
            Self::Viewer => "viewer",
        }
    }
}

impl From<MemberRole> for MemberRoleDto {
    fn from(role: MemberRole) -> Self {
        match role {
            MemberRole::Owner => Self::Owner,
            MemberRole::Admin => Self::Admin,
            MemberRole::Developer => Self::Developer,
            MemberRole::Deployer => Self::Deployer,
            MemberRole::Viewer => Self::Viewer,
        }
    }
}

pub(crate) fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/_api/organizations/{organization_id}/members",
            get(list_members),
        )
        .route(
            "/_api/organizations/{organization_id}/members/{user_id}",
            patch(update_member_role).delete(remove_member),
        )
}

#[utoipa::path(
    get,
    path = "/_api/organizations/{organization_id}/members",
    tag = "members",
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
        .members
        .list_members(session.user.id, organization_id)
        .await?
        .into_iter()
        .map(Into::into)
        .collect();
    Ok(no_store(Json(MembersResponse { members })))
}

#[utoipa::path(
    patch,
    path = "/_api/organizations/{organization_id}/members/{user_id}",
    tag = "members",
    params(
        ("organization_id" = Uuid, Path, description = "Organization ID"),
        ("user_id" = Uuid, Path, description = "Member user ID"),
        ("x-csrf-token" = String, Header, description = "CSRF token issued with the session")
    ),
    request_body = UpdateMemberRoleRequest,
    responses(
        (status = 200, description = "Member role updated", body = MemberEnvelope),
        (status = 400, description = "JSON or path parameter is invalid", body = ErrorResponse),
        (status = 401, description = "Session is absent or invalid", body = ErrorResponse),
        (status = 403, description = "Current role cannot perform this update", body = ErrorResponse),
        (status = 404, description = "Target member is missing", body = ErrorResponse),
        (status = 409, description = "Update would remove the last owner", body = ErrorResponse),
        (status = 503, description = "Membership storage is unavailable", body = ErrorResponse)
    )
)]
pub(crate) async fn update_member_role(
    State(state): State<AppState>,
    jar: CookieJar,
    headers: HeaderMap,
    Path((organization_id, user_id)): Path<(String, String)>,
    payload: Result<Json<UpdateMemberRoleRequest>, JsonRejection>,
) -> Result<impl IntoResponse, ApiError> {
    let session = authenticate(&state, &jar).await?;
    require_csrf(&state, &session, &headers)?;
    let organization_id = parse_uuid(&organization_id)?;
    let target_user_id = parse_uuid(&user_id)?;
    let Json(payload) = payload.map_err(|_| ApiError::invalid_json())?;
    let member = state
        .members
        .update_role(UpdateMemberRoleCommand {
            organization_id,
            actor_id: session.user.id,
            target_user_id,
            role: payload.role.as_str().to_owned(),
        })
        .await?;
    Ok(no_store(Json(MemberEnvelope {
        member: member.into(),
    })))
}

#[utoipa::path(
    delete,
    path = "/_api/organizations/{organization_id}/members/{user_id}",
    tag = "members",
    params(
        ("organization_id" = Uuid, Path, description = "Organization ID"),
        ("user_id" = Uuid, Path, description = "Member user ID"),
        ("x-csrf-token" = String, Header, description = "CSRF token issued with the session")
    ),
    responses(
        (status = 204, description = "Member removed"),
        (status = 400, description = "Path parameter is invalid", body = ErrorResponse),
        (status = 401, description = "Session is absent or invalid", body = ErrorResponse),
        (status = 403, description = "Current member cannot perform this removal", body = ErrorResponse),
        (status = 404, description = "Target member is missing", body = ErrorResponse),
        (status = 409, description = "Removal would remove the last owner", body = ErrorResponse),
        (status = 503, description = "Membership storage is unavailable", body = ErrorResponse)
    )
)]
pub(crate) async fn remove_member(
    State(state): State<AppState>,
    jar: CookieJar,
    headers: HeaderMap,
    Path((organization_id, user_id)): Path<(String, String)>,
) -> Result<impl IntoResponse, ApiError> {
    let session = authenticate(&state, &jar).await?;
    require_csrf(&state, &session, &headers)?;
    let organization_id = parse_uuid(&organization_id)?;
    let target_user_id = parse_uuid(&user_id)?;
    state
        .members
        .remove_member(RemoveMemberCommand {
            organization_id,
            actor_id: session.user.id,
            target_user_id,
        })
        .await?;
    Ok((
        [(header::CACHE_CONTROL, HeaderValue::from_static("no-store"))],
        StatusCode::NO_CONTENT,
    ))
}

impl From<MembersError> for ApiError {
    fn from(error: MembersError) -> Self {
        let status = match error {
            MembersError::InvalidRole => StatusCode::UNPROCESSABLE_ENTITY,
            MembersError::Forbidden => StatusCode::FORBIDDEN,
            MembersError::NotFound => StatusCode::NOT_FOUND,
            MembersError::LastOwner => StatusCode::CONFLICT,
            MembersError::Infrastructure => StatusCode::SERVICE_UNAVAILABLE,
        };
        Self::new(status, error.code())
    }
}

impl From<Member> for MemberResponse {
    fn from(member: Member) -> Self {
        Self {
            user_id: member.user_id,
            email: member.email,
            display_name: member.display_name,
            role: member.role.into(),
            joined_at: format_timestamp(member.joined_at),
        }
    }
}
