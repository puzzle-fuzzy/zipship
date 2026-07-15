use super::AppState;
use crate::error::{ApiError, ErrorResponse};
use crate::members::MemberRoleDto;
use crate::request::{authenticate, format_timestamp, no_store, parse_uuid, require_csrf};
use axum::{
    Json, Router,
    extract::{Path, State, rejection::JsonRejection},
    http::{HeaderMap, HeaderValue, StatusCode, header},
    response::IntoResponse,
    routing::{get, post},
};
use axum_extra::extract::CookieJar;
use secrecy::ExposeSecret;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;
use zipship_invitations::{
    AcceptInvitationCommand, AcceptedInvitation, CreateInvitationCommand, Invitation,
    InvitationState, InvitationsError, RevokeInvitationCommand,
};

#[derive(Debug, Deserialize, ToSchema)]
pub(crate) struct CreateInvitationRequest {
    email: String,
    role: MemberRoleDto,
}

#[derive(Debug, Deserialize, ToSchema)]
pub(crate) struct AcceptInvitationRequest {
    token: String,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct IssuedInvitationResponse {
    invitation: InvitationResponse,
    accept_token: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub(crate) struct InvitationsResponse {
    invitations: Vec<InvitationResponse>,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct InvitationResponse {
    id: Uuid,
    organization_id: Uuid,
    email: String,
    role: MemberRoleDto,
    state: InvitationStateDto,
    invited_by: Option<Uuid>,
    created_at: String,
    expires_at: String,
}

#[derive(Debug, Clone, Copy, Serialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub(crate) enum InvitationStateDto {
    Pending,
    Accepted,
    Revoked,
    Expired,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AcceptedInvitationResponse {
    invitation_id: Uuid,
    organization_id: Uuid,
    user_id: Uuid,
    role: MemberRoleDto,
    replayed: bool,
}

pub(crate) fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/_api/organizations/{organization_id}/invitations",
            get(list_invitations).post(create_invitation),
        )
        .route(
            "/_api/organizations/{organization_id}/invitations/{invitation_id}",
            axum::routing::delete(revoke_invitation),
        )
        .route("/_api/invitations/accept", post(accept_invitation))
}

#[utoipa::path(
    post,
    path = "/_api/organizations/{organization_id}/invitations",
    tag = "invitations",
    params(
        ("organization_id" = Uuid, Path, description = "Organization ID"),
        ("x-csrf-token" = String, Header, description = "CSRF token issued with the session")
    ),
    request_body = CreateInvitationRequest,
    responses(
        (status = 201, description = "Invitation created; the acceptance token is returned once", body = IssuedInvitationResponse),
        (status = 400, description = "JSON or path parameter is invalid", body = ErrorResponse),
        (status = 401, description = "Session is absent or invalid", body = ErrorResponse),
        (status = 403, description = "Current role cannot create this invitation", body = ErrorResponse),
        (status = 409, description = "Email is already a member or has an active invitation", body = ErrorResponse),
        (status = 422, description = "Email or role is invalid", body = ErrorResponse),
        (status = 503, description = "Invitation storage is unavailable", body = ErrorResponse)
    )
)]
pub(crate) async fn create_invitation(
    State(state): State<AppState>,
    jar: CookieJar,
    headers: HeaderMap,
    Path(organization_id): Path<String>,
    payload: Result<Json<CreateInvitationRequest>, JsonRejection>,
) -> Result<impl IntoResponse, ApiError> {
    let session = authenticate(&state, &jar).await?;
    require_csrf(&state, &session, &headers)?;
    let organization_id = parse_uuid(&organization_id)?;
    let Json(payload) = payload.map_err(|_| ApiError::invalid_json())?;
    let issued = state
        .invitations
        .create(CreateInvitationCommand {
            organization_id,
            actor_id: session.user.id,
            email: payload.email,
            role: payload.role.as_str().to_owned(),
        })
        .await?;
    Ok((
        StatusCode::CREATED,
        no_store(Json(IssuedInvitationResponse {
            invitation: issued.invitation.into(),
            accept_token: issued.accept_token.expose_secret().to_owned(),
        })),
    ))
}

#[utoipa::path(
    get,
    path = "/_api/organizations/{organization_id}/invitations",
    tag = "invitations",
    params(("organization_id" = Uuid, Path, description = "Organization ID")),
    responses(
        (status = 200, description = "Active invitations visible to the current manager", body = InvitationsResponse),
        (status = 400, description = "Path parameter is invalid", body = ErrorResponse),
        (status = 401, description = "Session is absent or invalid", body = ErrorResponse),
        (status = 403, description = "Current role cannot view invitations", body = ErrorResponse),
        (status = 503, description = "Invitation storage is unavailable", body = ErrorResponse)
    )
)]
pub(crate) async fn list_invitations(
    State(state): State<AppState>,
    jar: CookieJar,
    Path(organization_id): Path<String>,
) -> Result<impl IntoResponse, ApiError> {
    let session = authenticate(&state, &jar).await?;
    let organization_id = parse_uuid(&organization_id)?;
    let invitations = state
        .invitations
        .list(session.user.id, organization_id)
        .await?
        .into_iter()
        .map(Into::into)
        .collect();
    Ok(no_store(Json(InvitationsResponse { invitations })))
}

#[utoipa::path(
    delete,
    path = "/_api/organizations/{organization_id}/invitations/{invitation_id}",
    tag = "invitations",
    params(
        ("organization_id" = Uuid, Path, description = "Organization ID"),
        ("invitation_id" = Uuid, Path, description = "Invitation ID"),
        ("x-csrf-token" = String, Header, description = "CSRF token issued with the session")
    ),
    responses(
        (status = 204, description = "Invitation revoked"),
        (status = 400, description = "Path parameter is invalid", body = ErrorResponse),
        (status = 401, description = "Session is absent or invalid", body = ErrorResponse),
        (status = 403, description = "Current role cannot revoke this invitation", body = ErrorResponse),
        (status = 404, description = "Active invitation is missing", body = ErrorResponse),
        (status = 410, description = "Invitation expired before revocation", body = ErrorResponse),
        (status = 503, description = "Invitation storage is unavailable", body = ErrorResponse)
    )
)]
pub(crate) async fn revoke_invitation(
    State(state): State<AppState>,
    jar: CookieJar,
    headers: HeaderMap,
    Path((organization_id, invitation_id)): Path<(String, String)>,
) -> Result<impl IntoResponse, ApiError> {
    let session = authenticate(&state, &jar).await?;
    require_csrf(&state, &session, &headers)?;
    let organization_id = parse_uuid(&organization_id)?;
    let invitation_id = parse_uuid(&invitation_id)?;
    state
        .invitations
        .revoke(RevokeInvitationCommand {
            organization_id,
            actor_id: session.user.id,
            invitation_id,
        })
        .await?;
    Ok((
        [(header::CACHE_CONTROL, HeaderValue::from_static("no-store"))],
        StatusCode::NO_CONTENT,
    ))
}

#[utoipa::path(
    post,
    path = "/_api/invitations/accept",
    tag = "invitations",
    params(("x-csrf-token" = String, Header, description = "CSRF token issued with the session")),
    request_body = AcceptInvitationRequest,
    responses(
        (status = 200, description = "Invitation accepted or safely replayed", body = AcceptedInvitationResponse),
        (status = 400, description = "JSON is invalid", body = ErrorResponse),
        (status = 401, description = "Session is absent or invalid", body = ErrorResponse),
        (status = 403, description = "Invitation belongs to another email", body = ErrorResponse),
        (status = 404, description = "Invitation token is invalid or revoked", body = ErrorResponse),
        (status = 409, description = "Current user is already an organization member", body = ErrorResponse),
        (status = 410, description = "Invitation has expired", body = ErrorResponse),
        (status = 503, description = "Invitation storage is unavailable", body = ErrorResponse)
    )
)]
pub(crate) async fn accept_invitation(
    State(state): State<AppState>,
    jar: CookieJar,
    headers: HeaderMap,
    payload: Result<Json<AcceptInvitationRequest>, JsonRejection>,
) -> Result<impl IntoResponse, ApiError> {
    let session = authenticate(&state, &jar).await?;
    require_csrf(&state, &session, &headers)?;
    let Json(payload) = payload.map_err(|_| ApiError::invalid_json())?;
    let accepted = state
        .invitations
        .accept(AcceptInvitationCommand {
            actor_id: session.user.id,
            actor_email: session.user.email.as_str().to_owned(),
            token: payload.token,
        })
        .await?;
    Ok(no_store(Json(AcceptedInvitationResponse::from(accepted))))
}

impl From<InvitationsError> for ApiError {
    fn from(error: InvitationsError) -> Self {
        let status = match error {
            InvitationsError::InvalidEmail | InvitationsError::InvalidRole => {
                StatusCode::UNPROCESSABLE_ENTITY
            }
            InvitationsError::Forbidden | InvitationsError::WrongRecipient => StatusCode::FORBIDDEN,
            InvitationsError::AlreadyMember | InvitationsError::Pending => StatusCode::CONFLICT,
            InvitationsError::NotFound => StatusCode::NOT_FOUND,
            InvitationsError::Expired => StatusCode::GONE,
            InvitationsError::Infrastructure => StatusCode::SERVICE_UNAVAILABLE,
        };
        Self::new(status, error.code())
    }
}

impl From<Invitation> for InvitationResponse {
    fn from(invitation: Invitation) -> Self {
        Self {
            id: invitation.id,
            organization_id: invitation.organization_id,
            email: invitation.email,
            role: invitation.role.into(),
            state: invitation.state.into(),
            invited_by: invitation.invited_by,
            created_at: format_timestamp(invitation.created_at),
            expires_at: format_timestamp(invitation.expires_at),
        }
    }
}

impl From<InvitationState> for InvitationStateDto {
    fn from(state: InvitationState) -> Self {
        match state {
            InvitationState::Pending => Self::Pending,
            InvitationState::Accepted => Self::Accepted,
            InvitationState::Revoked => Self::Revoked,
            InvitationState::Expired => Self::Expired,
        }
    }
}

impl From<AcceptedInvitation> for AcceptedInvitationResponse {
    fn from(accepted: AcceptedInvitation) -> Self {
        Self {
            invitation_id: accepted.invitation_id,
            organization_id: accepted.organization_id,
            user_id: accepted.user_id,
            role: accepted.role.into(),
            replayed: accepted.replayed,
        }
    }
}
