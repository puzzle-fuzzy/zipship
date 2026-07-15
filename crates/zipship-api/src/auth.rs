use super::AppState;
use crate::error::{ApiError, ErrorResponse};
use axum::{
    Json, Router,
    extract::{State, rejection::JsonRejection},
    http::{HeaderMap, HeaderValue, StatusCode, header},
    response::IntoResponse,
    routing::{get, post},
};
use axum_extra::extract::CookieJar;
use axum_extra::extract::cookie::{Cookie, SameSite};
use secrecy::{ExposeSecret, SecretString};
use serde::{Deserialize, Serialize};
use time::Duration;
use utoipa::ToSchema;
use uuid::Uuid;
use zipship_auth::{AuthError, AuthOutcome, LoginCommand, RegisterCommand, UserProfile};

const SESSION_COOKIE: &str = "zipship_session";
const CSRF_COOKIE: &str = "zipship_csrf";
pub(crate) const CSRF_HEADER: &str = "x-csrf-token";

#[derive(Debug, Clone, Copy)]
pub struct CookiePolicy {
    secure: bool,
}

impl CookiePolicy {
    pub const fn new(secure: bool) -> Self {
        Self { secure }
    }
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RegisterRequest {
    email: String,
    display_name: String,
    password: String,
}

#[derive(Debug, Deserialize, ToSchema)]
pub(crate) struct LoginRequest {
    email: String,
    password: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub(crate) struct AuthResponse {
    user: UserResponse,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UserResponse {
    id: Uuid,
    email: String,
    display_name: String,
}

impl From<AuthError> for ApiError {
    fn from(error: AuthError) -> Self {
        let status = match error {
            AuthError::InvalidEmail
            | AuthError::InvalidDisplayName
            | AuthError::InvalidPassword => StatusCode::UNPROCESSABLE_ENTITY,
            AuthError::DuplicateEmail => StatusCode::CONFLICT,
            AuthError::InvalidCredentials | AuthError::Unauthenticated => StatusCode::UNAUTHORIZED,
            AuthError::AccountDisabled | AuthError::InvalidCsrfToken => StatusCode::FORBIDDEN,
            AuthError::Infrastructure => StatusCode::SERVICE_UNAVAILABLE,
        };
        Self::new(status, error.code())
    }
}

pub(crate) fn router() -> Router<AppState> {
    Router::new()
        .route("/_api/auth/register", post(register))
        .route("/_api/auth/login", post(login))
        .route("/_api/auth/me", get(me))
        .route("/_api/auth/logout", post(logout))
}

#[utoipa::path(
    post,
    path = "/_api/auth/register",
    tag = "auth",
    request_body = RegisterRequest,
    responses(
        (status = 201, description = "Account and browser session created", body = AuthResponse),
        (status = 409, description = "Email already exists", body = ErrorResponse),
        (status = 422, description = "Registration input is invalid", body = ErrorResponse),
        (status = 503, description = "Authentication storage is unavailable", body = ErrorResponse)
    )
)]
pub(crate) async fn register(
    State(state): State<AppState>,
    jar: CookieJar,
    payload: Result<Json<RegisterRequest>, JsonRejection>,
) -> Result<impl IntoResponse, ApiError> {
    let Json(payload) = payload.map_err(|_| ApiError::invalid_json())?;
    let outcome = state
        .auth
        .register(RegisterCommand {
            email: payload.email,
            display_name: payload.display_name,
            password: SecretString::from(payload.password),
        })
        .await?;
    let (jar, response) = session_response(jar, outcome, state.cookie_policy);
    Ok((
        StatusCode::CREATED,
        [(header::CACHE_CONTROL, HeaderValue::from_static("no-store"))],
        jar,
        Json(response),
    ))
}

#[utoipa::path(
    post,
    path = "/_api/auth/login",
    tag = "auth",
    request_body = LoginRequest,
    responses(
        (status = 200, description = "Browser session created", body = AuthResponse),
        (status = 401, description = "Credentials are invalid", body = ErrorResponse),
        (status = 403, description = "Account is disabled", body = ErrorResponse),
        (status = 503, description = "Authentication storage is unavailable", body = ErrorResponse)
    )
)]
pub(crate) async fn login(
    State(state): State<AppState>,
    jar: CookieJar,
    payload: Result<Json<LoginRequest>, JsonRejection>,
) -> Result<impl IntoResponse, ApiError> {
    let Json(payload) = payload.map_err(|_| ApiError::invalid_json())?;
    let outcome = state
        .auth
        .login(LoginCommand {
            email: payload.email,
            password: SecretString::from(payload.password),
        })
        .await?;
    let (jar, response) = session_response(jar, outcome, state.cookie_policy);
    Ok((
        StatusCode::OK,
        [(header::CACHE_CONTROL, HeaderValue::from_static("no-store"))],
        jar,
        Json(response),
    ))
}

#[utoipa::path(
    get,
    path = "/_api/auth/me",
    tag = "auth",
    responses(
        (status = 200, description = "Current user", body = AuthResponse),
        (status = 401, description = "Session is absent or invalid", body = ErrorResponse),
        (status = 503, description = "Authentication storage is unavailable", body = ErrorResponse)
    )
)]
pub(crate) async fn me(
    State(state): State<AppState>,
    jar: CookieJar,
) -> Result<impl IntoResponse, ApiError> {
    let token = session_token(&jar)?;
    let session = state.auth.authenticate(token).await?;
    Ok((
        StatusCode::OK,
        [(header::CACHE_CONTROL, HeaderValue::from_static("no-store"))],
        Json(AuthResponse {
            user: session.profile().into(),
        }),
    ))
}

#[utoipa::path(
    post,
    path = "/_api/auth/logout",
    tag = "auth",
    params(("x-csrf-token" = String, Header, description = "CSRF token issued with the session")),
    responses(
        (status = 204, description = "Session revoked and cookies cleared"),
        (status = 401, description = "Session is absent or invalid", body = ErrorResponse),
        (status = 403, description = "CSRF token is absent or invalid", body = ErrorResponse),
        (status = 503, description = "Authentication storage is unavailable", body = ErrorResponse)
    )
)]
pub(crate) async fn logout(
    State(state): State<AppState>,
    jar: CookieJar,
    headers: HeaderMap,
) -> Result<impl IntoResponse, ApiError> {
    let token = session_token(&jar)?;
    let session = state.auth.authenticate(token).await?;
    let csrf = headers
        .get(CSRF_HEADER)
        .and_then(|value| value.to_str().ok())
        .ok_or_else(|| ApiError::new(StatusCode::FORBIDDEN, "INVALID_CSRF_TOKEN"))?;
    state.auth.verify_csrf(&session, csrf)?;
    state.auth.logout(token).await?;

    Ok((
        StatusCode::NO_CONTENT,
        [(header::CACHE_CONTROL, HeaderValue::from_static("no-store"))],
        clear_session_cookies(jar, state.cookie_policy),
    ))
}

fn session_response(
    jar: CookieJar,
    outcome: AuthOutcome,
    policy: CookiePolicy,
) -> (CookieJar, AuthResponse) {
    let browser_session_cookie = session_cookie(
        SESSION_COOKIE,
        outcome.credentials.session_token().expose_secret(),
        true,
        policy,
    );
    let csrf_cookie = session_cookie(
        CSRF_COOKIE,
        outcome.credentials.csrf_token().expose_secret(),
        false,
        policy,
    );
    (
        jar.add(browser_session_cookie).add(csrf_cookie),
        AuthResponse {
            user: outcome.user.into(),
        },
    )
}

fn session_cookie(
    name: &'static str,
    value: &str,
    http_only: bool,
    policy: CookiePolicy,
) -> Cookie<'static> {
    Cookie::build((name, value.to_owned()))
        .path("/")
        .http_only(http_only)
        .secure(policy.secure)
        .same_site(SameSite::Strict)
        .max_age(Duration::days(7))
        .build()
}

fn clear_session_cookies(jar: CookieJar, policy: CookiePolicy) -> CookieJar {
    let session = removal_cookie(SESSION_COOKIE, true, policy);
    let csrf = removal_cookie(CSRF_COOKIE, false, policy);
    jar.remove(session).remove(csrf)
}

fn removal_cookie(name: &'static str, http_only: bool, policy: CookiePolicy) -> Cookie<'static> {
    Cookie::build(name)
        .path("/")
        .http_only(http_only)
        .secure(policy.secure)
        .same_site(SameSite::Strict)
        .build()
}

pub(crate) fn session_token(jar: &CookieJar) -> Result<&str, ApiError> {
    jar.get(SESSION_COOKIE)
        .map(Cookie::value)
        .ok_or_else(|| AuthError::Unauthenticated.into())
}

impl From<UserProfile> for UserResponse {
    fn from(user: UserProfile) -> Self {
        Self {
            id: user.id,
            email: user.email,
            display_name: user.display_name,
        }
    }
}
