#![forbid(unsafe_code)]

use async_trait::async_trait;
use axum::{
    Json, Router,
    extract::DefaultBodyLimit,
    http::{HeaderName, HeaderValue, StatusCode, header},
    routing::get,
};
use serde::Serialize;
use std::{collections::BTreeMap, sync::Arc, time::Duration};
use tower_http::{
    catch_panic::CatchPanicLayer,
    request_id::{MakeRequestUuid, PropagateRequestIdLayer, SetRequestIdLayer},
    sensitive_headers::SetSensitiveRequestHeadersLayer,
    set_header::SetResponseHeaderLayer,
    timeout::TimeoutLayer,
    trace::TraceLayer,
};
use utoipa::{OpenApi, ToSchema};
use zipship_auth::AuthService;

mod auth;

pub use auth::CookiePolicy;

#[derive(Debug, Clone, Serialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum CheckStatus {
    Ok,
    Failed,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct HealthResponse {
    pub status: CheckStatus,
    pub service: &'static str,
    pub version: &'static str,
    pub checks: BTreeMap<String, CheckStatus>,
}

#[async_trait]
pub trait ReadinessProbe: Send + Sync + 'static {
    async fn check(&self) -> BTreeMap<String, CheckStatus>;
}

#[derive(Clone)]
pub struct AppState {
    pub(crate) readiness: Arc<dyn ReadinessProbe>,
    pub(crate) auth: AuthService,
    pub(crate) cookie_policy: CookiePolicy,
}

impl AppState {
    pub fn new(
        readiness: Arc<dyn ReadinessProbe>,
        auth: AuthService,
        cookie_policy: CookiePolicy,
    ) -> Self {
        Self {
            readiness,
            auth,
            cookie_policy,
        }
    }
}

#[derive(OpenApi)]
#[openapi(
    paths(
        liveness,
        readiness,
        auth::register,
        auth::login,
        auth::me,
        auth::logout
    ),
    components(schemas(
        CheckStatus,
        HealthResponse,
        auth::RegisterRequest,
        auth::LoginRequest,
        auth::AuthResponse,
        auth::UserResponse,
        auth::ErrorResponse
    )),
    tags(
        (name = "health", description = "Process and dependency health"),
        (name = "auth", description = "Browser session authentication")
    )
)]
pub struct ApiDoc;

pub fn build_router(state: AppState) -> Router {
    let request_id_header = HeaderName::from_static("x-request-id");

    Router::new()
        .route("/_health/live", get(liveness))
        .route("/_health/ready", get(readiness))
        .route("/_api/openapi.json", get(openapi))
        .merge(auth::router())
        .with_state(state)
        .layer(DefaultBodyLimit::max(16 * 1_024))
        .layer(SetResponseHeaderLayer::if_not_present(
            header::X_CONTENT_TYPE_OPTIONS,
            HeaderValue::from_static("nosniff"),
        ))
        .layer(SetSensitiveRequestHeadersLayer::new([
            header::AUTHORIZATION,
            header::COOKIE,
        ]))
        .layer(TimeoutLayer::with_status_code(
            StatusCode::REQUEST_TIMEOUT,
            Duration::from_secs(30),
        ))
        .layer(CatchPanicLayer::new())
        .layer(TraceLayer::new_for_http())
        .layer(PropagateRequestIdLayer::new(request_id_header.clone()))
        .layer(SetRequestIdLayer::new(request_id_header, MakeRequestUuid))
}

#[utoipa::path(
    get,
    path = "/_health/live",
    tag = "health",
    responses((status = 200, description = "Process is alive", body = HealthResponse))
)]
async fn liveness() -> Json<HealthResponse> {
    Json(HealthResponse {
        status: CheckStatus::Ok,
        service: "zipshipd",
        version: env!("CARGO_PKG_VERSION"),
        checks: BTreeMap::new(),
    })
}

#[utoipa::path(
    get,
    path = "/_health/ready",
    tag = "health",
    responses(
        (status = 200, description = "Dependencies are ready", body = HealthResponse),
        (status = 503, description = "At least one dependency is unavailable", body = HealthResponse)
    )
)]
async fn readiness(
    axum::extract::State(state): axum::extract::State<AppState>,
) -> (StatusCode, Json<HealthResponse>) {
    let checks = state.readiness.check().await;
    let ready = checks
        .values()
        .all(|status| matches!(status, CheckStatus::Ok));
    let status = if ready {
        StatusCode::OK
    } else {
        StatusCode::SERVICE_UNAVAILABLE
    };

    (
        status,
        Json(HealthResponse {
            status: if ready {
                CheckStatus::Ok
            } else {
                CheckStatus::Failed
            },
            service: "zipshipd",
            version: env!("CARGO_PKG_VERSION"),
            checks,
        }),
    )
}

async fn openapi() -> Json<utoipa::openapi::OpenApi> {
    Json(ApiDoc::openapi())
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        body::{Body, to_bytes},
        http::{Request, header},
    };
    use serde_json::{Value, json};
    use std::sync::Mutex;
    use time::OffsetDateTime;
    use tower::ServiceExt;
    use zipship_auth::{
        AuthRepository, AuthRepositoryError, NewSession, NewUser, NormalizedEmail, ResolvedSession,
        StoredUser, TokenDigest,
    };

    struct Probe {
        status: CheckStatus,
    }

    #[async_trait]
    impl ReadinessProbe for Probe {
        async fn check(&self) -> BTreeMap<String, CheckStatus> {
            BTreeMap::from([("database".to_owned(), self.status.clone())])
        }
    }

    #[derive(Default)]
    struct AuthState {
        users: Vec<StoredUser>,
        sessions: Vec<NewSession>,
    }

    #[derive(Default)]
    struct TestAuthRepository {
        state: Mutex<AuthState>,
    }

    #[async_trait]
    impl AuthRepository for TestAuthRepository {
        async fn create_user_with_session(
            &self,
            user: NewUser,
            session: NewSession,
        ) -> Result<(), AuthRepositoryError> {
            let mut state = self.state.lock().unwrap();
            if state.users.iter().any(|stored| stored.email == user.email) {
                return Err(AuthRepositoryError::DuplicateEmail);
            }
            state.users.push(stored_user(user));
            state.sessions.push(session);
            Ok(())
        }

        async fn find_user_by_email(
            &self,
            email: &NormalizedEmail,
        ) -> Result<Option<StoredUser>, AuthRepositoryError> {
            Ok(self
                .state
                .lock()
                .unwrap()
                .users
                .iter()
                .find(|user| &user.email == email)
                .cloned())
        }

        async fn create_session(&self, session: NewSession) -> Result<(), AuthRepositoryError> {
            self.state.lock().unwrap().sessions.push(session);
            Ok(())
        }

        async fn resolve_session(
            &self,
            token_digest: TokenDigest,
            now: OffsetDateTime,
        ) -> Result<Option<ResolvedSession>, AuthRepositoryError> {
            let state = self.state.lock().unwrap();
            let Some(session) = state
                .sessions
                .iter()
                .find(|session| session.token_digest == token_digest && session.expires_at > now)
            else {
                return Ok(None);
            };
            Ok(state
                .users
                .iter()
                .find(|user| user.id == session.user_id)
                .cloned()
                .map(|user| ResolvedSession {
                    session_id: session.id,
                    user,
                    csrf_digest: session.csrf_digest,
                }))
        }

        async fn revoke_session(
            &self,
            token_digest: TokenDigest,
            _revoked_at: OffsetDateTime,
        ) -> Result<(), AuthRepositoryError> {
            self.state
                .lock()
                .unwrap()
                .sessions
                .retain(|session| session.token_digest != token_digest);
            Ok(())
        }
    }

    fn stored_user(user: NewUser) -> StoredUser {
        StoredUser {
            id: user.id,
            email: user.email,
            display_name: user.display_name,
            password_hash: user.password_hash,
            disabled_at: None,
        }
    }

    async fn test_app(status: CheckStatus, secure_cookies: bool) -> Router {
        let auth = AuthService::new(Arc::new(TestAuthRepository::default()))
            .await
            .unwrap();
        build_router(AppState::new(
            Arc::new(Probe { status }),
            auth,
            CookiePolicy::new(secure_cookies),
        ))
    }

    fn register_request() -> Request<Body> {
        Request::post("/_api/auth/register")
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(
                json!({
                    "email": "owner@example.com",
                    "displayName": "Owner",
                    "password": "correct horse battery staple"
                })
                .to_string(),
            ))
            .unwrap()
    }

    fn response_cookie(response: &axum::response::Response, name: &str) -> String {
        response
            .headers()
            .get_all(header::SET_COOKIE)
            .iter()
            .filter_map(|value| value.to_str().ok())
            .find(|value| value.starts_with(&format!("{name}=")))
            .unwrap()
            .to_owned()
    }

    fn cookie_pair(set_cookie: &str) -> &str {
        set_cookie.split(';').next().unwrap()
    }

    fn cookie_value(set_cookie: &str) -> &str {
        cookie_pair(set_cookie).split_once('=').unwrap().1
    }

    async fn json_body(response: axum::response::Response) -> Value {
        serde_json::from_slice(&to_bytes(response.into_body(), 32 * 1_024).await.unwrap()).unwrap()
    }

    #[tokio::test]
    async fn liveness_does_not_depend_on_external_services() {
        let app = test_app(CheckStatus::Failed, false).await;
        let response = app
            .oneshot(Request::get("/_health/live").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert!(response.headers().contains_key("x-request-id"));
    }

    #[tokio::test]
    async fn readiness_reports_dependency_failures() {
        let app = test_app(CheckStatus::Failed, false).await;
        let response = app
            .oneshot(Request::get("/_health/ready").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
    }

    #[tokio::test]
    async fn publishes_the_openapi_contract() {
        let app = test_app(CheckStatus::Ok, false).await;
        let response = app
            .oneshot(
                Request::get("/_api/openapi.json")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response
                .headers()
                .get(header::CONTENT_TYPE)
                .unwrap()
                .to_str()
                .unwrap(),
            "application/json",
        );
        let document = json_body(response).await;
        assert!(document["paths"]["/_api/auth/register"].is_object());
        assert!(document["paths"]["/_api/auth/logout"].is_object());
    }

    #[tokio::test]
    async fn registration_issues_hardened_session_cookies() {
        let app = test_app(CheckStatus::Ok, true).await;
        let response = app.oneshot(register_request()).await.unwrap();
        assert_eq!(response.status(), StatusCode::CREATED);
        assert_eq!(
            response.headers().get(header::CACHE_CONTROL).unwrap(),
            "no-store",
        );

        let session = response_cookie(&response, "zipship_session");
        let csrf = response_cookie(&response, "zipship_csrf");
        let session_lower = session.to_ascii_lowercase();
        let csrf_lower = csrf.to_ascii_lowercase();
        assert!(session_lower.contains("httponly"));
        assert!(!csrf_lower.contains("httponly"));
        for cookie in [&session_lower, &csrf_lower] {
            assert!(cookie.contains("secure"));
            assert!(cookie.contains("samesite=strict"));
            assert!(cookie.contains("path=/"));
            assert!(cookie.contains("max-age=604800"));
        }

        let body = json_body(response).await;
        assert_eq!(body["user"]["email"], "owner@example.com");
        assert!(body.get("sessionToken").is_none());
        assert!(body.get("csrfToken").is_none());
    }

    #[tokio::test]
    async fn invalid_json_uses_a_stable_error_shape() {
        let app = test_app(CheckStatus::Ok, false).await;
        let response = app
            .oneshot(
                Request::post("/_api/auth/register")
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from("{"))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        assert_eq!(json_body(response).await, json!({ "code": "INVALID_JSON" }));
    }

    #[tokio::test]
    async fn logout_requires_csrf_and_revokes_the_session() {
        let app = test_app(CheckStatus::Ok, false).await;
        let registered = app.clone().oneshot(register_request()).await.unwrap();
        let session = response_cookie(&registered, "zipship_session");
        let csrf = response_cookie(&registered, "zipship_csrf");
        let cookie_header = format!("{}; {}", cookie_pair(&session), cookie_pair(&csrf));

        let current = app
            .clone()
            .oneshot(
                Request::get("/_api/auth/me")
                    .header(header::COOKIE, &cookie_header)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(current.status(), StatusCode::OK);

        let missing_csrf = app
            .clone()
            .oneshot(
                Request::post("/_api/auth/logout")
                    .header(header::COOKIE, &cookie_header)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(missing_csrf.status(), StatusCode::FORBIDDEN);
        assert_eq!(
            json_body(missing_csrf).await,
            json!({ "code": "INVALID_CSRF_TOKEN" }),
        );

        let logged_out = app
            .clone()
            .oneshot(
                Request::post("/_api/auth/logout")
                    .header(header::COOKIE, &cookie_header)
                    .header("x-csrf-token", cookie_value(&csrf))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(logged_out.status(), StatusCode::NO_CONTENT);
        assert!(
            response_cookie(&logged_out, "zipship_session")
                .to_ascii_lowercase()
                .contains("max-age=0"),
        );

        let rejected = app
            .oneshot(
                Request::get("/_api/auth/me")
                    .header(header::COOKIE, cookie_header)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(rejected.status(), StatusCode::UNAUTHORIZED);
        assert_eq!(
            json_body(rejected).await,
            json!({ "code": "UNAUTHENTICATED" }),
        );
    }
}
