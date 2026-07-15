use crate::{
    AppState,
    error::{ApiError, ErrorResponse},
    request::{authenticate, format_timestamp, no_store, parse_uuid, require_csrf},
};
use axum::{
    Json, Router,
    extract::{Path, State, rejection::JsonRejection},
    http::{HeaderMap, HeaderValue, StatusCode, header},
    response::IntoResponse,
    routing::get,
};
use axum_extra::extract::CookieJar;
use secrecy::ExposeSecret;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;
use zipship_tokens::{
    ApiToken, ApiTokenScope, ApiTokenState, ApiTokensError, CreateApiTokenCommand,
    RevokeApiTokenCommand,
};

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CreateApiTokenRequest {
    name: String,
    scopes: Vec<ApiTokenScopeDto>,
    #[schema(minimum = 1, maximum = 365)]
    expires_in_days: u16,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, ToSchema)]
pub(crate) enum ApiTokenScopeDto {
    #[serde(rename = "projects:read")]
    ProjectsRead,
    #[serde(rename = "releases:read")]
    ReleasesRead,
    #[serde(rename = "uploads:write")]
    UploadsWrite,
    #[serde(rename = "deployments:write")]
    DeploymentsWrite,
}

impl ApiTokenScopeDto {
    const fn as_str(self) -> &'static str {
        match self {
            Self::ProjectsRead => "projects:read",
            Self::ReleasesRead => "releases:read",
            Self::UploadsWrite => "uploads:write",
            Self::DeploymentsWrite => "deployments:write",
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub(crate) enum ApiTokenStateDto {
    Active,
    Expired,
    Revoked,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ApiTokenResponse {
    id: Uuid,
    name: String,
    display_prefix: String,
    scopes: Vec<ApiTokenScopeDto>,
    state: ApiTokenStateDto,
    expires_at: String,
    last_used_at: Option<String>,
    revoked_at: Option<String>,
    created_at: String,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct IssuedApiTokenResponse {
    api_token: ApiTokenResponse,
    secret: String,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ApiTokensResponse {
    api_tokens: Vec<ApiTokenResponse>,
}

pub(crate) fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/_api/api-tokens",
            get(list_api_tokens).post(create_api_token),
        )
        .route(
            "/_api/api-tokens/{token_id}",
            axum::routing::delete(revoke_api_token),
        )
}

#[utoipa::path(
    post,
    path = "/_api/api-tokens",
    tag = "api-tokens",
    security(("cookieAuth" = [])),
    params(("x-csrf-token" = String, Header, description = "CSRF token issued with the session")),
    request_body = CreateApiTokenRequest,
    responses(
        (status = 201, description = "Token created; the secret is returned only once", body = IssuedApiTokenResponse),
        (status = 400, description = "JSON is invalid", body = ErrorResponse),
        (status = 401, description = "Browser session is absent or invalid", body = ErrorResponse),
        (status = 403, description = "CSRF token is absent or invalid", body = ErrorResponse),
        (status = 409, description = "Active token limit reached", body = ErrorResponse),
        (status = 422, description = "Name, scopes, or expiration is invalid", body = ErrorResponse),
        (status = 503, description = "Token storage is unavailable", body = ErrorResponse)
    )
)]
pub(crate) async fn create_api_token(
    State(state): State<AppState>,
    jar: CookieJar,
    headers: HeaderMap,
    payload: Result<Json<CreateApiTokenRequest>, JsonRejection>,
) -> Result<impl IntoResponse, ApiError> {
    let session = authenticate(&state, &jar).await?;
    require_csrf(&state, &session, &headers)?;
    let Json(payload) = payload.map_err(|_| ApiError::invalid_json())?;
    let issued = state
        .tokens
        .create(CreateApiTokenCommand {
            user_id: session.user.id,
            name: payload.name,
            scopes: payload
                .scopes
                .into_iter()
                .map(|scope| scope.as_str().to_owned())
                .collect(),
            expires_in_days: payload.expires_in_days,
        })
        .await?;
    let token_state = state.tokens.state(&issued.token);
    Ok((
        StatusCode::CREATED,
        no_store(Json(IssuedApiTokenResponse {
            api_token: ApiTokenResponse::new(issued.token, token_state),
            secret: issued.secret.expose_secret().to_owned(),
        })),
    ))
}

#[utoipa::path(
    get,
    path = "/_api/api-tokens",
    tag = "api-tokens",
    security(("cookieAuth" = [])),
    responses(
        (status = 200, description = "Active tokens first followed by recent history", body = ApiTokensResponse),
        (status = 401, description = "Browser session is absent or invalid", body = ErrorResponse),
        (status = 503, description = "Token storage is unavailable", body = ErrorResponse)
    )
)]
pub(crate) async fn list_api_tokens(
    State(state): State<AppState>,
    jar: CookieJar,
) -> Result<impl IntoResponse, ApiError> {
    let session = authenticate(&state, &jar).await?;
    let api_tokens = state
        .tokens
        .list(session.user.id)
        .await?
        .into_iter()
        .map(|token| {
            let token_state = state.tokens.state(&token);
            ApiTokenResponse::new(token, token_state)
        })
        .collect();
    Ok(no_store(Json(ApiTokensResponse { api_tokens })))
}

#[utoipa::path(
    delete,
    path = "/_api/api-tokens/{token_id}",
    tag = "api-tokens",
    security(("cookieAuth" = [])),
    params(
        ("token_id" = Uuid, Path, description = "API token ID"),
        ("x-csrf-token" = String, Header, description = "CSRF token issued with the session")
    ),
    responses(
        (status = 204, description = "Token revoked; replay is safe"),
        (status = 400, description = "Path parameter is invalid", body = ErrorResponse),
        (status = 401, description = "Browser session is absent or invalid", body = ErrorResponse),
        (status = 403, description = "CSRF token is absent or invalid", body = ErrorResponse),
        (status = 404, description = "Token does not belong to the current user", body = ErrorResponse),
        (status = 503, description = "Token storage is unavailable", body = ErrorResponse)
    )
)]
pub(crate) async fn revoke_api_token(
    State(state): State<AppState>,
    jar: CookieJar,
    headers: HeaderMap,
    Path(token_id): Path<String>,
) -> Result<impl IntoResponse, ApiError> {
    let session = authenticate(&state, &jar).await?;
    require_csrf(&state, &session, &headers)?;
    state
        .tokens
        .revoke(RevokeApiTokenCommand {
            user_id: session.user.id,
            token_id: parse_uuid(&token_id)?,
        })
        .await?;
    Ok((
        StatusCode::NO_CONTENT,
        [(header::CACHE_CONTROL, HeaderValue::from_static("no-store"))],
    ))
}

impl From<ApiTokensError> for ApiError {
    fn from(error: ApiTokensError) -> Self {
        let status = match error {
            ApiTokensError::InvalidName
            | ApiTokensError::InvalidScopes
            | ApiTokensError::InvalidExpiration => StatusCode::UNPROCESSABLE_ENTITY,
            ApiTokensError::LimitReached => StatusCode::CONFLICT,
            ApiTokensError::NotFound => StatusCode::NOT_FOUND,
            ApiTokensError::Unauthenticated => StatusCode::UNAUTHORIZED,
            ApiTokensError::Infrastructure => StatusCode::SERVICE_UNAVAILABLE,
        };
        Self::new(status, error.code())
    }
}

impl ApiTokenResponse {
    fn new(token: ApiToken, state: ApiTokenState) -> Self {
        Self {
            id: token.id,
            name: token.name,
            display_prefix: token.display_prefix,
            scopes: token.scopes.into_iter().map(Into::into).collect(),
            state: state.into(),
            expires_at: format_timestamp(token.expires_at),
            last_used_at: token.last_used_at.map(format_timestamp),
            revoked_at: token.revoked_at.map(format_timestamp),
            created_at: format_timestamp(token.created_at),
        }
    }
}

impl From<ApiTokenScope> for ApiTokenScopeDto {
    fn from(scope: ApiTokenScope) -> Self {
        match scope {
            ApiTokenScope::ProjectsRead => Self::ProjectsRead,
            ApiTokenScope::ReleasesRead => Self::ReleasesRead,
            ApiTokenScope::UploadsWrite => Self::UploadsWrite,
            ApiTokenScope::DeploymentsWrite => Self::DeploymentsWrite,
        }
    }
}

impl From<ApiTokenState> for ApiTokenStateDto {
    fn from(state: ApiTokenState) -> Self {
        match state {
            ApiTokenState::Active => Self::Active,
            ApiTokenState::Expired => Self::Expired,
            ApiTokenState::Revoked => Self::Revoked,
        }
    }
}
