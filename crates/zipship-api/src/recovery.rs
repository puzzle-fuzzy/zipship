use super::AppState;
use crate::{
    auth::clear_session_cookies,
    error::{ApiError, ErrorResponse},
};
use axum::{
    Json, Router,
    extract::{ConnectInfo, State, rejection::JsonRejection},
    http::{HeaderMap, HeaderValue, StatusCode, header},
    response::IntoResponse,
    routing::post,
};
use axum_extra::extract::CookieJar;
use secrecy::SecretString;
use serde::Deserialize;
use std::net::SocketAddr;
use utoipa::ToSchema;
use zipship_recovery::{
    ConfirmPasswordResetCommand, PasswordRecoveryError, RequestPasswordResetCommand,
};

#[derive(Debug, Deserialize, ToSchema)]
pub(crate) struct RequestPasswordResetRequest {
    email: String,
}

#[derive(Debug, Deserialize, ToSchema)]
pub(crate) struct ConfirmPasswordResetRequest {
    token: String,
    password: String,
}

impl From<PasswordRecoveryError> for ApiError {
    fn from(error: PasswordRecoveryError) -> Self {
        let status = match error {
            PasswordRecoveryError::InvalidPassword => StatusCode::UNPROCESSABLE_ENTITY,
            PasswordRecoveryError::InvalidToken => StatusCode::BAD_REQUEST,
            PasswordRecoveryError::Infrastructure => StatusCode::SERVICE_UNAVAILABLE,
        };
        Self::new(status, error.code())
    }
}

pub(crate) fn router() -> Router<AppState> {
    Router::new()
        .route("/_api/auth/password-resets", post(request_password_reset))
        .route(
            "/_api/auth/password-resets/confirm",
            post(confirm_password_reset),
        )
}

#[utoipa::path(
    post,
    path = "/_api/auth/password-resets",
    tag = "auth",
    request_body = RequestPasswordResetRequest,
    responses(
        (status = 202, description = "Password reset request accepted whether or not the account is eligible"),
        (status = 400, description = "Request JSON is invalid", body = ErrorResponse),
        (status = 503, description = "Password recovery storage is unavailable", body = ErrorResponse)
    )
)]
pub(crate) async fn request_password_reset(
    State(state): State<AppState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    payload: Result<Json<RequestPasswordResetRequest>, JsonRejection>,
) -> Result<impl IntoResponse, ApiError> {
    let Json(payload) = payload.map_err(|_| ApiError::invalid_json())?;
    let client = state.anonymous.client_ip(peer.ip(), &headers);
    if state.anonymous.allow_password_reset_request(client) {
        state
            .recovery
            .request(RequestPasswordResetCommand {
                email: payload.email,
            })
            .await?;
    }
    Ok((
        StatusCode::ACCEPTED,
        [(header::CACHE_CONTROL, HeaderValue::from_static("no-store"))],
    ))
}

#[utoipa::path(
    post,
    path = "/_api/auth/password-resets/confirm",
    tag = "auth",
    request_body = ConfirmPasswordResetRequest,
    responses(
        (status = 204, description = "Password changed, all sessions revoked, and browser cookies cleared"),
        (status = 400, description = "Request JSON or reset token is invalid", body = ErrorResponse),
        (status = 422, description = "New password does not satisfy policy", body = ErrorResponse),
        (status = 429, description = "Too many anonymous confirmation attempts", body = ErrorResponse),
        (status = 503, description = "Password recovery storage is unavailable", body = ErrorResponse)
    )
)]
pub(crate) async fn confirm_password_reset(
    State(state): State<AppState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    jar: CookieJar,
    payload: Result<Json<ConfirmPasswordResetRequest>, JsonRejection>,
) -> Result<impl IntoResponse, ApiError> {
    let Json(payload) = payload.map_err(|_| ApiError::invalid_json())?;
    let client = state.anonymous.client_ip(peer.ip(), &headers);
    if !state.anonymous.allow_password_reset_confirmation(client) {
        return Err(ApiError::new(
            StatusCode::TOO_MANY_REQUESTS,
            "ANONYMOUS_RATE_LIMITED",
        ));
    }
    state
        .recovery
        .confirm(ConfirmPasswordResetCommand {
            token: payload.token,
            password: SecretString::from(payload.password),
        })
        .await?;
    Ok((
        StatusCode::NO_CONTENT,
        [(header::CACHE_CONTROL, HeaderValue::from_static("no-store"))],
        clear_session_cookies(jar, state.cookie_policy),
    ))
}
