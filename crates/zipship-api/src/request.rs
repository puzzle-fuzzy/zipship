use crate::{AppState, auth, error::ApiError};
use axum::{
    Json,
    http::{HeaderMap, HeaderValue, StatusCode, header},
};
use axum_extra::extract::CookieJar;
use time::{OffsetDateTime, format_description::well_known::Rfc3339};
use uuid::Uuid;

pub(crate) async fn authenticate(
    state: &AppState,
    jar: &CookieJar,
) -> Result<zipship_auth::ResolvedSession, ApiError> {
    let token = auth::session_token(jar)?;
    state.auth.authenticate(token).await.map_err(Into::into)
}

pub(crate) fn require_csrf(
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

pub(crate) fn parse_uuid(value: &str) -> Result<Uuid, ApiError> {
    Uuid::parse_str(value).map_err(|_| ApiError::invalid_path_parameter())
}

pub(crate) fn no_store<T>(body: Json<T>) -> ([(header::HeaderName, HeaderValue); 1], Json<T>) {
    (
        [(header::CACHE_CONTROL, HeaderValue::from_static("no-store"))],
        body,
    )
}

pub(crate) fn format_timestamp(value: OffsetDateTime) -> String {
    value
        .format(&Rfc3339)
        .expect("OffsetDateTime must be representable as RFC 3339")
}
