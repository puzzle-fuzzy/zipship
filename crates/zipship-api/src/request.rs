use crate::{AppState, auth, error::ApiError};
use axum::{
    Json,
    http::{HeaderMap, HeaderValue, StatusCode, header},
};
use axum_extra::extract::CookieJar;
use time::{OffsetDateTime, format_description::well_known::Rfc3339};
use uuid::Uuid;
use zipship_tokens::{ApiTokenPrincipal, ApiTokenScope};

pub(crate) enum ResourceCredential {
    Session(zipship_auth::ResolvedSession),
    ApiToken(ApiTokenPrincipal),
}

impl ResourceCredential {
    pub fn user_id(&self) -> Uuid {
        match self {
            Self::Session(session) => session.user.id,
            Self::ApiToken(principal) => principal.user_id,
        }
    }
}

pub(crate) async fn authenticate(
    state: &AppState,
    jar: &CookieJar,
) -> Result<zipship_auth::ResolvedSession, ApiError> {
    let token = auth::session_token(jar)?;
    state.auth.authenticate(token).await.map_err(Into::into)
}

pub(crate) async fn authenticate_resource(
    state: &AppState,
    jar: &CookieJar,
    headers: &HeaderMap,
    required_scope: ApiTokenScope,
) -> Result<ResourceCredential, ApiError> {
    let mut authorization_values = headers.get_all(header::AUTHORIZATION).iter();
    if let Some(value) = authorization_values.next() {
        if authorization_values.next().is_some() {
            return Err(unauthenticated());
        }
        let value = value.to_str().map_err(|_| unauthenticated())?;
        let secret = parse_bearer(value).ok_or_else(unauthenticated)?;
        let principal = state.tokens.authenticate(secret).await?;
        if !principal.allows(required_scope) {
            return Err(ApiError::new(
                StatusCode::FORBIDDEN,
                "API_TOKEN_SCOPE_FORBIDDEN",
            ));
        }
        return Ok(ResourceCredential::ApiToken(principal));
    }

    authenticate(state, jar)
        .await
        .map(ResourceCredential::Session)
}

pub(crate) fn require_resource_csrf(
    state: &AppState,
    credential: &ResourceCredential,
    headers: &HeaderMap,
) -> Result<(), ApiError> {
    match credential {
        ResourceCredential::Session(session) => require_csrf(state, session, headers),
        ResourceCredential::ApiToken(_) => Ok(()),
    }
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

fn parse_bearer(value: &str) -> Option<&str> {
    let mut parts = value.split_ascii_whitespace();
    let scheme = parts.next()?;
    let secret = parts.next()?;
    if !scheme.eq_ignore_ascii_case("bearer") || secret.is_empty() || parts.next().is_some() {
        return None;
    }
    Some(secret)
}

fn unauthenticated() -> ApiError {
    ApiError::new(StatusCode::UNAUTHORIZED, "UNAUTHENTICATED")
}

#[cfg(test)]
mod tests;
