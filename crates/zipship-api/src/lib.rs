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
use zipship_projects::ProjectsService;
use zipship_storage::LocalArtifactStore;
use zipship_uploads::UploadsService;

mod auth;
mod error;
mod projects;
mod request;
mod uploads;

pub use auth::CookiePolicy;
use error::ErrorResponse;

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
    pub(crate) projects: ProjectsService,
    pub(crate) uploads: UploadsService,
    pub(crate) storage: LocalArtifactStore,
    pub(crate) cookie_policy: CookiePolicy,
}

impl AppState {
    pub fn new(
        readiness: Arc<dyn ReadinessProbe>,
        auth: AuthService,
        projects: ProjectsService,
        uploads: UploadsService,
        storage: LocalArtifactStore,
        cookie_policy: CookiePolicy,
    ) -> Self {
        Self {
            readiness,
            auth,
            projects,
            uploads,
            storage,
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
        auth::logout,
        projects::list_organizations,
        projects::list_members,
        projects::list_projects,
        projects::create_project,
        projects::get_project,
        uploads::create_upload,
        uploads::upload_content,
        uploads::finalize_upload,
        uploads::get_upload
    ),
    components(schemas(
        CheckStatus,
        HealthResponse,
        auth::RegisterRequest,
        auth::LoginRequest,
        auth::AuthResponse,
        auth::UserResponse,
        projects::OrganizationsResponse,
        projects::OrganizationResponse,
        projects::MembersResponse,
        projects::MemberResponse,
        projects::CreateProjectRequest,
        projects::ProjectResponse,
        projects::ProjectEnvelope,
        projects::ProjectsResponse,
        uploads::CreateUploadRequest,
        uploads::UploadEnvelope,
        uploads::UploadResponse,
        uploads::FinalizeUploadResponse,
        ErrorResponse
    )),
    tags(
        (name = "health", description = "Process and dependency health"),
        (name = "auth", description = "Browser session authentication"),
        (name = "organizations", description = "Organizations and memberships"),
        (name = "projects", description = "Static deployment projects"),
        (name = "uploads", description = "Bounded archive ingestion and processing")
    )
)]
pub struct ApiDoc;

pub fn build_router(state: AppState) -> Router {
    let request_id_header = HeaderName::from_static("x-request-id");

    let standard_routes = Router::new()
        .route("/_health/live", get(liveness))
        .route("/_health/ready", get(readiness))
        .route("/_api/openapi.json", get(openapi))
        .merge(auth::router())
        .merge(projects::router())
        .merge(uploads::standard_router())
        .layer(DefaultBodyLimit::max(16 * 1_024))
        .layer(TimeoutLayer::with_status_code(
            StatusCode::REQUEST_TIMEOUT,
            Duration::from_secs(30),
        ));

    standard_routes
        .merge(uploads::content_router())
        .with_state(state)
        .layer(SetResponseHeaderLayer::if_not_present(
            header::X_CONTENT_TYPE_OPTIONS,
            HeaderValue::from_static("nosniff"),
        ))
        .layer(SetSensitiveRequestHeadersLayer::new([
            header::AUTHORIZATION,
            header::COOKIE,
        ]))
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
    use uuid::Uuid;
    use zipship_auth::{
        AuthRepository, AuthRepositoryError, NewPersonalOrganization, NewSession, NewUser,
        NormalizedEmail, ResolvedSession, StoredUser, TokenDigest,
    };
    use zipship_domain::{CachePolicy, MemberRole, UploadStatus};
    use zipship_projects::{
        MemberSummary, NewProject, OrganizationSummary, Project, ProjectAccess, ProjectsRepository,
        ProjectsRepositoryError,
    };
    use zipship_uploads::{
        BeginReceiveResult, FinalizeResult, FinalizedUpload, NewUpload, ReceiveLease, UploadLimits,
        UploadRecord, UploadsRepository, UploadsRepositoryError,
    };

    const TEST_ORGANIZATION_ID: Uuid = Uuid::from_u128(1);

    struct Probe {
        status: CheckStatus,
        _storage_root: tempfile::TempDir,
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

    #[derive(Default)]
    struct TestProjectsRepository {
        projects: Mutex<Vec<Project>>,
    }

    #[derive(Default)]
    struct UploadState {
        upload: Option<UploadRecord>,
        transfer_id: Option<Uuid>,
        finalized: Option<FinalizedUpload>,
    }

    #[derive(Default)]
    struct TestUploadsRepository {
        state: Mutex<UploadState>,
    }

    #[async_trait]
    impl UploadsRepository for TestUploadsRepository {
        async fn project_role(
            &self,
            _project_id: Uuid,
            _actor_id: Uuid,
        ) -> Result<Option<MemberRole>, UploadsRepositoryError> {
            Ok(Some(MemberRole::Owner))
        }

        async fn create_upload(
            &self,
            upload: NewUpload,
        ) -> Result<UploadRecord, UploadsRepositoryError> {
            let record = UploadRecord {
                id: upload.id,
                project_id: upload.project_id,
                release_id: None,
                original_filename: upload.original_filename.as_str().to_owned(),
                status: UploadStatus::Pending,
                expected_size: upload.expected_size.bytes(),
                received_size: 0,
                staging_key: upload.staging_key,
                created_by: upload.created_by,
                created_at: upload.created_at,
                uploaded_at: None,
                completed_at: None,
                expires_at: upload.expires_at,
                error_code: None,
            };
            self.state.lock().unwrap().upload = Some(record.clone());
            Ok(record)
        }

        async fn begin_receive(
            &self,
            upload_id: Uuid,
            _actor_id: Uuid,
            transfer_id: Uuid,
            now: OffsetDateTime,
            _lease_expires_at: OffsetDateTime,
        ) -> Result<BeginReceiveResult, UploadsRepositoryError> {
            let mut state = self.state.lock().unwrap();
            let upload = state
                .upload
                .as_mut()
                .filter(|upload| upload.id == upload_id)
                .ok_or(UploadsRepositoryError::NotFound)?;
            if upload.expires_at <= now {
                return Err(UploadsRepositoryError::Expired);
            }
            if matches!(
                upload.status,
                UploadStatus::Uploaded | UploadStatus::Processing | UploadStatus::Completed
            ) {
                return Ok(BeginReceiveResult::AlreadyUploaded(upload.clone()));
            }
            if upload.status != UploadStatus::Pending {
                return Err(UploadsRepositoryError::StateConflict);
            }
            upload.status = UploadStatus::Receiving;
            upload.received_size = 0;
            upload.error_code = None;
            let upload = upload.clone();
            state.transfer_id = Some(transfer_id);
            Ok(BeginReceiveResult::Started(ReceiveLease {
                upload,
                transfer_id,
            }))
        }

        async fn mark_uploaded(
            &self,
            upload_id: Uuid,
            _actor_id: Uuid,
            transfer_id: Uuid,
            received_size: u64,
            now: OffsetDateTime,
        ) -> Result<UploadRecord, UploadsRepositoryError> {
            let mut state = self.state.lock().unwrap();
            if state.transfer_id != Some(transfer_id) {
                return Err(UploadsRepositoryError::StateConflict);
            }
            let upload = state
                .upload
                .as_mut()
                .filter(|upload| upload.id == upload_id)
                .ok_or(UploadsRepositoryError::NotFound)?;
            if received_size != upload.expected_size {
                return Err(UploadsRepositoryError::SizeMismatch);
            }
            upload.status = UploadStatus::Uploaded;
            upload.received_size = received_size;
            upload.uploaded_at = Some(now);
            upload.error_code = None;
            Ok(upload.clone())
        }

        async fn requeue_receive(
            &self,
            upload_id: Uuid,
            _actor_id: Uuid,
            transfer_id: Uuid,
            error_code: &'static str,
            _now: OffsetDateTime,
        ) -> Result<(), UploadsRepositoryError> {
            let mut state = self.state.lock().unwrap();
            if state.transfer_id != Some(transfer_id) {
                return Err(UploadsRepositoryError::StateConflict);
            }
            let upload = state
                .upload
                .as_mut()
                .filter(|upload| upload.id == upload_id)
                .ok_or(UploadsRepositoryError::NotFound)?;
            upload.status = UploadStatus::Pending;
            upload.received_size = 0;
            upload.error_code = Some(error_code.to_owned());
            state.transfer_id = None;
            Ok(())
        }

        async fn finalize_upload(
            &self,
            upload_id: Uuid,
            _actor_id: Uuid,
            _now: OffsetDateTime,
        ) -> Result<FinalizeResult, UploadsRepositoryError> {
            let mut state = self.state.lock().unwrap();
            if let Some(finalized) = state.finalized.clone() {
                return Ok(FinalizeResult::Existing(finalized));
            }
            let upload = state
                .upload
                .as_mut()
                .filter(|upload| upload.id == upload_id)
                .ok_or(UploadsRepositoryError::NotFound)?;
            if upload.status != UploadStatus::Uploaded {
                return Err(UploadsRepositoryError::StateConflict);
            }
            let release_id = Uuid::new_v4();
            let job_id = Uuid::new_v4();
            upload.status = UploadStatus::Processing;
            upload.release_id = Some(release_id);
            let finalized = FinalizedUpload {
                upload: upload.clone(),
                release_id,
                job_id,
            };
            state.finalized = Some(finalized.clone());
            Ok(FinalizeResult::Created(finalized))
        }

        async fn find_upload_for_member(
            &self,
            upload_id: Uuid,
            _actor_id: Uuid,
        ) -> Result<Option<UploadRecord>, UploadsRepositoryError> {
            Ok(self
                .state
                .lock()
                .unwrap()
                .upload
                .clone()
                .filter(|upload| upload.id == upload_id))
        }
    }

    #[async_trait]
    impl ProjectsRepository for TestProjectsRepository {
        async fn list_organizations(
            &self,
            _actor_id: Uuid,
        ) -> Result<Vec<OrganizationSummary>, ProjectsRepositoryError> {
            Ok(vec![OrganizationSummary {
                id: TEST_ORGANIZATION_ID,
                name: "Test Organization".to_owned(),
                slug: "test-organization".to_owned(),
                role: MemberRole::Owner,
                created_at: OffsetDateTime::UNIX_EPOCH,
            }])
        }

        async fn membership_role(
            &self,
            organization_id: Uuid,
            _actor_id: Uuid,
        ) -> Result<Option<MemberRole>, ProjectsRepositoryError> {
            Ok((organization_id == TEST_ORGANIZATION_ID).then_some(MemberRole::Owner))
        }

        async fn list_members(
            &self,
            organization_id: Uuid,
            actor_id: Uuid,
        ) -> Result<Vec<MemberSummary>, ProjectsRepositoryError> {
            if organization_id != TEST_ORGANIZATION_ID {
                return Err(ProjectsRepositoryError::Forbidden);
            }
            Ok(vec![MemberSummary {
                user_id: actor_id,
                email: "owner@example.com".to_owned(),
                display_name: "Owner".to_owned(),
                role: MemberRole::Owner,
                joined_at: OffsetDateTime::UNIX_EPOCH,
            }])
        }

        async fn create_project(
            &self,
            project: NewProject,
        ) -> Result<Project, ProjectsRepositoryError> {
            if project.organization_id != TEST_ORGANIZATION_ID {
                return Err(ProjectsRepositoryError::Forbidden);
            }
            let mut projects = self.projects.lock().unwrap();
            if projects
                .iter()
                .any(|stored| stored.slug == project.slug.as_str())
            {
                return Err(ProjectsRepositoryError::DuplicateSlug);
            }
            let project = Project {
                id: project.id,
                organization_id: project.organization_id,
                name: project.name.as_str().to_owned(),
                slug: project.slug.as_str().to_owned(),
                description: project.description.into_inner(),
                spa_fallback: true,
                cache_policy: CachePolicy::Standard,
                active_release_id: None,
                created_by: project.created_by,
                created_at: project.created_at,
                updated_at: project.created_at,
            };
            projects.push(project.clone());
            Ok(project)
        }

        async fn list_projects(
            &self,
            organization_id: Uuid,
            _actor_id: Uuid,
        ) -> Result<Vec<Project>, ProjectsRepositoryError> {
            if organization_id != TEST_ORGANIZATION_ID {
                return Err(ProjectsRepositoryError::Forbidden);
            }
            Ok(self.projects.lock().unwrap().clone())
        }

        async fn find_project_for_member(
            &self,
            project_id: Uuid,
            _actor_id: Uuid,
        ) -> Result<Option<ProjectAccess>, ProjectsRepositoryError> {
            Ok(self
                .projects
                .lock()
                .unwrap()
                .iter()
                .find(|project| project.id == project_id)
                .cloned()
                .map(|project| ProjectAccess {
                    project,
                    role: MemberRole::Owner,
                }))
        }
    }

    #[async_trait]
    impl AuthRepository for TestAuthRepository {
        async fn create_user_with_session(
            &self,
            user: NewUser,
            _organization: NewPersonalOrganization,
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
        test_app_with_storage(status, secure_cookies).await.0
    }

    async fn test_app_with_storage(
        status: CheckStatus,
        secure_cookies: bool,
    ) -> (Router, LocalArtifactStore) {
        let auth = AuthService::new(Arc::new(TestAuthRepository::default()))
            .await
            .unwrap();
        let projects = ProjectsService::new(Arc::new(TestProjectsRepository::default()));
        let uploads = UploadsService::new(
            Arc::new(TestUploadsRepository::default()),
            UploadLimits {
                maximum_bytes: 1_024 * 1_024,
                upload_ttl: Duration::from_secs(600),
                receive_lease: Duration::from_secs(60),
            },
        );
        let storage_root = tempfile::tempdir().unwrap();
        let storage = LocalArtifactStore::new(storage_root.path());
        storage.ensure_layout().await.unwrap();
        let app = build_router(AppState::new(
            Arc::new(Probe {
                status,
                _storage_root: storage_root,
            }),
            auth,
            projects,
            uploads,
            storage.clone(),
            CookiePolicy::new(secure_cookies),
        ));
        (app, storage)
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
        assert!(document["paths"]["/_api/organizations"].is_object());
        assert!(document["paths"]["/_api/projects/{project_id}"].is_object());
        assert!(document["paths"]["/_api/projects/{project_id}/uploads"].is_object());
        assert!(document["paths"]["/_api/uploads/{upload_id}/content"].is_object());
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

    #[tokio::test]
    async fn project_routes_require_session_and_csrf() {
        let app = test_app(CheckStatus::Ok, false).await;
        let registered = app.clone().oneshot(register_request()).await.unwrap();
        let session = response_cookie(&registered, "zipship_session");
        let csrf = response_cookie(&registered, "zipship_csrf");
        let cookie_header = format!("{}; {}", cookie_pair(&session), cookie_pair(&csrf));

        let organizations = app
            .clone()
            .oneshot(
                Request::get("/_api/organizations")
                    .header(header::COOKIE, &cookie_header)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(organizations.status(), StatusCode::OK);
        assert_eq!(
            json_body(organizations).await["organizations"][0]["id"],
            TEST_ORGANIZATION_ID.to_string(),
        );

        let project_path = format!("/_api/organizations/{TEST_ORGANIZATION_ID}/projects");
        let request_body = json!({
            "name": " Marketing Site ",
            "slug": " Marketing-Site ",
            "description": " Campaign frontend "
        })
        .to_string();
        let missing_csrf = app
            .clone()
            .oneshot(
                Request::post(&project_path)
                    .header(header::COOKIE, &cookie_header)
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(request_body.clone()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(missing_csrf.status(), StatusCode::FORBIDDEN);

        let created = app
            .clone()
            .oneshot(
                Request::post(&project_path)
                    .header(header::COOKIE, &cookie_header)
                    .header(header::CONTENT_TYPE, "application/json")
                    .header("x-csrf-token", cookie_value(&csrf))
                    .body(Body::from(request_body))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(created.status(), StatusCode::CREATED);
        let created = json_body(created).await;
        assert_eq!(created["project"]["slug"], "marketing-site");
        let project_id = created["project"]["id"].as_str().unwrap();

        let detail = app
            .clone()
            .oneshot(
                Request::get(format!("/_api/projects/{project_id}"))
                    .header(header::COOKIE, &cookie_header)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(detail.status(), StatusCode::OK);

        let invalid_path = app
            .oneshot(
                Request::get("/_api/projects/not-a-uuid")
                    .header(header::COOKIE, cookie_header)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(invalid_path.status(), StatusCode::BAD_REQUEST);
        assert_eq!(
            json_body(invalid_path).await,
            json!({ "code": "INVALID_PATH_PARAMETER" }),
        );
    }

    #[tokio::test]
    async fn upload_routes_stream_exact_archives_and_finalize_idempotently() {
        let (app, storage) = test_app_with_storage(CheckStatus::Ok, false).await;
        let registered = app.clone().oneshot(register_request()).await.unwrap();
        let session = response_cookie(&registered, "zipship_session");
        let csrf = response_cookie(&registered, "zipship_csrf");
        let cookie_header = format!("{}; {}", cookie_pair(&session), cookie_pair(&csrf));

        let project_path = format!("/_api/organizations/{TEST_ORGANIZATION_ID}/projects");
        let created_project = app
            .clone()
            .oneshot(
                Request::post(project_path)
                    .header(header::COOKIE, &cookie_header)
                    .header(header::CONTENT_TYPE, "application/json")
                    .header("x-csrf-token", cookie_value(&csrf))
                    .body(Body::from(
                        json!({
                            "name": "Marketing Site",
                            "slug": "marketing-site"
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        let project = json_body(created_project).await;
        let project_id = project["project"]["id"].as_str().unwrap();

        let archive = b"PK\x03\x04streamed frontend archive".to_vec();
        let created_upload = app
            .clone()
            .oneshot(
                Request::post(format!("/_api/projects/{project_id}/uploads"))
                    .header(header::COOKIE, &cookie_header)
                    .header(header::CONTENT_TYPE, "application/json")
                    .header("x-csrf-token", cookie_value(&csrf))
                    .body(Body::from(
                        json!({
                            "filename": "frontend.zip",
                            "sizeBytes": archive.len()
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(created_upload.status(), StatusCode::CREATED);
        let created_upload = json_body(created_upload).await;
        let upload_id = created_upload["upload"]["id"].as_str().unwrap();
        let upload_uuid = Uuid::parse_str(upload_id).unwrap();
        let content_path = format!("/_api/uploads/{upload_id}/content");

        let missing_length = app
            .clone()
            .oneshot(
                Request::put(&content_path)
                    .header(header::COOKIE, &cookie_header)
                    .header(header::CONTENT_TYPE, "application/zip")
                    .header("x-csrf-token", cookie_value(&csrf))
                    .body(Body::from(archive.clone()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(missing_length.status(), StatusCode::LENGTH_REQUIRED);
        assert_eq!(
            json_body(missing_length).await,
            json!({ "code": "CONTENT_LENGTH_REQUIRED" }),
        );

        let interrupted = app
            .clone()
            .oneshot(
                Request::put(&content_path)
                    .header(header::COOKIE, &cookie_header)
                    .header(header::CONTENT_TYPE, "application/zip")
                    .header(header::CONTENT_LENGTH, archive.len())
                    .header("x-csrf-token", cookie_value(&csrf))
                    .body(Body::from(archive[..archive.len() - 1].to_vec()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(interrupted.status(), StatusCode::UNPROCESSABLE_ENTITY);
        assert_eq!(
            json_body(interrupted).await,
            json!({ "code": "UPLOAD_SIZE_MISMATCH" }),
        );
        assert!(
            !tokio::fs::try_exists(storage.upload_archive_path(upload_uuid))
                .await
                .unwrap(),
        );

        let uploaded = app
            .clone()
            .oneshot(
                Request::put(&content_path)
                    .header(header::COOKIE, &cookie_header)
                    .header(header::CONTENT_TYPE, "application/zip")
                    .header(header::CONTENT_LENGTH, archive.len())
                    .header("x-csrf-token", cookie_value(&csrf))
                    .body(Body::from(archive.clone()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(uploaded.status(), StatusCode::OK);
        assert_eq!(json_body(uploaded).await["upload"]["status"], "uploaded");
        assert_eq!(
            tokio::fs::read(storage.upload_archive_path(upload_uuid))
                .await
                .unwrap(),
            archive,
        );

        let complete_path = format!("/_api/uploads/{upload_id}/complete");
        let first = app
            .clone()
            .oneshot(
                Request::post(&complete_path)
                    .header(header::COOKIE, &cookie_header)
                    .header("x-csrf-token", cookie_value(&csrf))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(first.status(), StatusCode::ACCEPTED);
        let first = json_body(first).await;
        assert_eq!(first["upload"]["status"], "processing");

        let second = app
            .clone()
            .oneshot(
                Request::post(&complete_path)
                    .header(header::COOKIE, &cookie_header)
                    .header("x-csrf-token", cookie_value(&csrf))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(second.status(), StatusCode::ACCEPTED);
        let second = json_body(second).await;
        assert_eq!(first["releaseId"], second["releaseId"]);
        assert_eq!(first["jobId"], second["jobId"]);
    }
}
