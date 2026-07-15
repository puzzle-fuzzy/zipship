#![forbid(unsafe_code)]

use async_trait::async_trait;
use axum::{
    Json, Router,
    extract::DefaultBodyLimit,
    http::{HeaderName, HeaderValue, Method, StatusCode, header},
    routing::get,
};
use serde::Serialize;
use std::{collections::BTreeMap, sync::Arc, time::Duration};
use tower_http::{
    catch_panic::CatchPanicLayer,
    cors::CorsLayer,
    request_id::{MakeRequestUuid, PropagateRequestIdLayer, SetRequestIdLayer},
    sensitive_headers::SetSensitiveRequestHeadersLayer,
    set_header::SetResponseHeaderLayer,
    timeout::TimeoutLayer,
    trace::TraceLayer,
};
use utoipa::{OpenApi, ToSchema};
use zipship_audit::AuditService;
use zipship_auth::AuthService;
use zipship_deployments::DeploymentsService;
use zipship_invitations::InvitationsService;
use zipship_members::MembersService;
use zipship_projects::ProjectsService;
use zipship_releases::ReleasesService;
use zipship_storage::LocalArtifactStore;
use zipship_uploads::UploadsService;

mod audit;
mod auth;
mod deployments;
mod error;
mod invitations;
mod members;
mod projects;
mod releases;
mod request;
mod uploads;

pub use auth::CookiePolicy;
use error::ErrorResponse;

#[derive(Debug)]
pub struct InvalidCorsPolicy;

impl std::fmt::Display for InvalidCorsPolicy {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("control-plane CORS policy has no valid origins")
    }
}

impl std::error::Error for InvalidCorsPolicy {}

#[derive(Clone)]
pub struct CorsPolicy {
    allowed_origins: Vec<HeaderValue>,
}

impl CorsPolicy {
    pub fn try_new(origins: impl IntoIterator<Item = String>) -> Result<Self, InvalidCorsPolicy> {
        let allowed_origins = origins
            .into_iter()
            .map(|origin| HeaderValue::from_str(&origin).map_err(|_| InvalidCorsPolicy))
            .collect::<Result<Vec<_>, _>>()?;
        if allowed_origins.is_empty() {
            return Err(InvalidCorsPolicy);
        }
        Ok(Self { allowed_origins })
    }

    fn layer(&self) -> CorsLayer {
        CorsLayer::new()
            .allow_origin(self.allowed_origins.clone())
            .allow_methods([
                Method::GET,
                Method::POST,
                Method::PUT,
                Method::PATCH,
                Method::DELETE,
            ])
            .allow_headers([
                header::CONTENT_TYPE,
                HeaderName::from_static("idempotency-key"),
                HeaderName::from_static("x-csrf-token"),
                HeaderName::from_static("x-request-id"),
            ])
            .allow_credentials(true)
            .expose_headers([HeaderName::from_static("x-request-id")])
            .max_age(Duration::from_secs(600))
    }
}

#[derive(Clone)]
pub struct BrowserPolicy {
    cookie_policy: CookiePolicy,
    cors_policy: CorsPolicy,
}

impl BrowserPolicy {
    pub fn new(cookie_policy: CookiePolicy, cors_policy: CorsPolicy) -> Self {
        Self {
            cookie_policy,
            cors_policy,
        }
    }
}

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
pub struct AppServices {
    pub auth: AuthService,
    pub audit: AuditService,
    pub deployments: DeploymentsService,
    pub invitations: InvitationsService,
    pub members: MembersService,
    pub projects: ProjectsService,
    pub releases: ReleasesService,
    pub uploads: UploadsService,
}

#[derive(Clone)]
pub struct AppState {
    pub(crate) readiness: Arc<dyn ReadinessProbe>,
    pub(crate) auth: AuthService,
    pub(crate) audit: AuditService,
    pub(crate) deployments: DeploymentsService,
    pub(crate) invitations: InvitationsService,
    pub(crate) members: MembersService,
    pub(crate) projects: ProjectsService,
    pub(crate) releases: ReleasesService,
    pub(crate) uploads: UploadsService,
    pub(crate) storage: LocalArtifactStore,
    pub(crate) cookie_policy: CookiePolicy,
    pub(crate) cors_policy: CorsPolicy,
}

impl AppState {
    pub fn new(
        readiness: Arc<dyn ReadinessProbe>,
        services: AppServices,
        storage: LocalArtifactStore,
        browser_policy: BrowserPolicy,
    ) -> Self {
        Self {
            readiness,
            auth: services.auth,
            audit: services.audit,
            deployments: services.deployments,
            invitations: services.invitations,
            members: services.members,
            projects: services.projects,
            releases: services.releases,
            uploads: services.uploads,
            storage,
            cookie_policy: browser_policy.cookie_policy,
            cors_policy: browser_policy.cors_policy,
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
        auth::update_profile,
        auth::logout,
        audit::list_audit_logs,
        deployments::publish,
        deployments::rollback,
        deployments::list_deployments,
        releases::list_releases,
        projects::list_organizations,
        members::list_members,
        members::update_member_role,
        members::remove_member,
        invitations::create_invitation,
        invitations::list_invitations,
        invitations::revoke_invitation,
        invitations::accept_invitation,
        projects::list_projects,
        projects::create_project,
        projects::get_project,
        projects::update_project,
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
        auth::UpdateProfileRequest,
        auth::AuthResponse,
        auth::UserResponse,
        audit::AuditLogsResponse,
        audit::AuditEntryResponse,
        audit::AuditActorResponse,
        deployments::DeploymentMessageRequest,
        deployments::DeploymentEnvelope,
        deployments::DeploymentResponse,
        deployments::DeploymentsResponse,
        releases::ReleasesResponse,
        releases::ReleaseResponse,
        releases::ReleaseArtifactResponse,
        releases::ArtifactManifestResponse,
        releases::ManifestEntryResponse,
        projects::OrganizationsResponse,
        projects::OrganizationResponse,
        members::MembersResponse,
        members::MemberEnvelope,
        members::MemberResponse,
        members::UpdateMemberRoleRequest,
        members::MemberRoleDto,
        invitations::CreateInvitationRequest,
        invitations::AcceptInvitationRequest,
        invitations::IssuedInvitationResponse,
        invitations::InvitationsResponse,
        invitations::InvitationResponse,
        invitations::InvitationStateDto,
        invitations::AcceptedInvitationResponse,
        projects::CreateProjectRequest,
        projects::UpdateProjectRequest,
        projects::ProjectCachePolicyRequest,
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
        (name = "audit", description = "Organization activity history"),
        (name = "deployments", description = "Idempotent release activation and rollback"),
        (name = "organizations", description = "Organizations and memberships"),
        (name = "members", description = "Organization member lifecycle"),
        (name = "invitations", description = "Secure organization invitation lifecycle"),
        (name = "projects", description = "Static deployment projects"),
        (name = "releases", description = "Immutable project release history"),
        (name = "uploads", description = "Bounded archive ingestion and processing")
    )
)]
pub struct ApiDoc;

pub fn openapi_document() -> utoipa::openapi::OpenApi {
    ApiDoc::openapi()
}

pub fn build_router(state: AppState) -> Router {
    let request_id_header = HeaderName::from_static("x-request-id");
    let cors = state.cors_policy.layer();

    let standard_routes = Router::new()
        .route("/_health/live", get(liveness))
        .route("/_health/ready", get(readiness))
        .route("/_api/openapi.json", get(openapi))
        .merge(auth::router())
        .merge(audit::router())
        .merge(deployments::router())
        .merge(invitations::router())
        .merge(members::router())
        .merge(projects::router())
        .merge(releases::router())
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
        .layer(cors)
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
    Json(openapi_document())
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
    use zipship_artifact::{ArtifactManifest, ManifestEntry};
    use zipship_audit::{
        AuditActor, AuditEntry, AuditPage, AuditPageRequest, AuditRepository, AuditRepositoryError,
        AuditService,
    };
    use zipship_auth::{
        AuthRepository, AuthRepositoryError, NewPersonalOrganization, NewSession, NewUser,
        NormalizedEmail, ResolvedSession, StoredUser, TokenDigest,
    };
    use zipship_deployments::{
        Deployment, DeploymentResult, DeploymentStatus, DeploymentsRepository,
        DeploymentsRepositoryError, DeploymentsService, NewDeployment,
    };
    use zipship_domain::{ArtifactDigest, CachePolicy, MemberRole, ReleaseStatus, UploadStatus};
    use zipship_invitations::{
        AcceptInvitation, AcceptedInvitation, Invitation, InvitationState, InvitationsRepository,
        InvitationsRepositoryError, InvitationsService, ListInvitations, NewInvitation,
        RevokeInvitation,
    };
    use zipship_members::{
        Member, MembersRepository, MembersRepositoryError, RemoveMember, UpdateMemberRole,
    };
    use zipship_projects::{
        NewProject, OrganizationSummary, Project, ProjectAccess, ProjectsRepository,
        ProjectsRepositoryError, UpdateProject,
    };
    use zipship_releases::{
        ProjectReleases, Release, ReleaseArtifact, ReleasesRepository, ReleasesRepositoryError,
        ReleasesService,
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

    struct TestMembersRepository;

    #[derive(Default)]
    struct TestInvitationsRepository {
        invitations: Mutex<Vec<(Invitation, TokenDigest)>>,
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

    #[derive(Default)]
    struct TestDeploymentsRepository {
        deployments: Mutex<Vec<Deployment>>,
    }

    #[async_trait]
    impl DeploymentsRepository for TestDeploymentsRepository {
        async fn execute(
            &self,
            command: NewDeployment,
        ) -> Result<DeploymentResult, DeploymentsRepositoryError> {
            let deployment = Deployment {
                id: command.id,
                project_id: command.project_id,
                release_id: command.release_id,
                previous_release_id: None,
                action: command.action,
                status: DeploymentStatus::Succeeded,
                actor_id: command.actor_id,
                message: command.message,
                created_at: command.now,
                finished_at: command.now,
            };
            self.deployments.lock().unwrap().push(deployment.clone());
            Ok(DeploymentResult {
                deployment,
                active_release_id: command.release_id,
                replayed: false,
            })
        }

        async fn list_for_project(
            &self,
            project_id: Uuid,
            _actor_id: Uuid,
        ) -> Result<Vec<Deployment>, DeploymentsRepositoryError> {
            Ok(self
                .deployments
                .lock()
                .unwrap()
                .iter()
                .rev()
                .filter(|deployment| deployment.project_id == project_id)
                .cloned()
                .collect())
        }
    }

    struct TestReleasesRepository;

    struct TestAuditRepository;

    #[async_trait]
    impl AuditRepository for TestAuditRepository {
        async fn list(&self, request: AuditPageRequest) -> Result<AuditPage, AuditRepositoryError> {
            Ok(AuditPage {
                entries: vec![AuditEntry {
                    id: Uuid::from_u128(71),
                    organization_id: request.organization_id,
                    project_id: request.project_id,
                    actor: Some(AuditActor {
                        id: request.actor_id,
                        email: "owner@example.com".to_owned(),
                        display_name: "Owner".to_owned(),
                    }),
                    action: "release.published".to_owned(),
                    target_type: "release".to_owned(),
                    target_id: Some(Uuid::from_u128(72)),
                    request_id: Some(Uuid::from_u128(73)),
                    metadata: json!({ "versionNumber": 2 }),
                    created_at: OffsetDateTime::UNIX_EPOCH,
                }],
                next_cursor: None,
            })
        }
    }

    #[async_trait]
    impl ReleasesRepository for TestReleasesRepository {
        async fn list_for_project(
            &self,
            project_id: Uuid,
            actor_id: Uuid,
        ) -> Result<ProjectReleases, ReleasesRepositoryError> {
            Ok(ProjectReleases {
                project_slug: zipship_domain::ProjectSlug::parse("marketing").unwrap(),
                releases: vec![Release {
                    id: Uuid::from_u128(91),
                    project_id,
                    version_number: 1,
                    state: ReleaseStatus::Ready,
                    failure_code: None,
                    artifact: Some(ReleaseArtifact {
                        digest: ArtifactDigest::parse("ab".repeat(32)).unwrap(),
                        file_count: 1,
                        total_size: 4,
                        manifest: ArtifactManifest {
                            version: 1,
                            files: vec![ManifestEntry {
                                path: "index.html".to_owned(),
                                size: 4,
                                sha256: "cd".repeat(32),
                            }],
                        },
                        detect_report: json!({ "entryDirectory": "dist" }),
                    }),
                    is_active: true,
                    created_by: actor_id,
                    created_at: OffsetDateTime::UNIX_EPOCH,
                    ready_at: Some(OffsetDateTime::UNIX_EPOCH),
                    archived_at: None,
                }],
            })
        }
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

        async fn update_project(
            &self,
            update: UpdateProject,
        ) -> Result<Project, ProjectsRepositoryError> {
            let mut projects = self.projects.lock().unwrap();
            if let Some(slug) = update.slug.as_ref()
                && projects
                    .iter()
                    .any(|project| project.id != update.project_id && project.slug == slug.as_str())
            {
                return Err(ProjectsRepositoryError::DuplicateSlug);
            }
            let project = projects
                .iter_mut()
                .find(|project| project.id == update.project_id)
                .ok_or(ProjectsRepositoryError::NotFound)?;
            if let Some(name) = update.name {
                project.name = name.as_str().to_owned();
            }
            if let Some(slug) = update.slug {
                project.slug = slug.as_str().to_owned();
            }
            if let Some(description) = update.description {
                project.description = description.into_inner();
            }
            if let Some(spa_fallback) = update.spa_fallback {
                project.spa_fallback = spa_fallback;
            }
            if let Some(cache_policy) = update.cache_policy {
                project.cache_policy = cache_policy;
            }
            project.updated_at = update.updated_at;
            Ok(project.clone())
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
    impl MembersRepository for TestMembersRepository {
        async fn list_members(
            &self,
            organization_id: Uuid,
            actor_id: Uuid,
        ) -> Result<Vec<Member>, MembersRepositoryError> {
            if organization_id != TEST_ORGANIZATION_ID {
                return Err(MembersRepositoryError::Forbidden);
            }
            Ok(vec![Member {
                user_id: actor_id,
                email: "owner@example.com".to_owned(),
                display_name: "Owner".to_owned(),
                role: MemberRole::Owner,
                joined_at: OffsetDateTime::UNIX_EPOCH,
            }])
        }

        async fn update_role(
            &self,
            update: UpdateMemberRole,
        ) -> Result<Member, MembersRepositoryError> {
            if update.organization_id != TEST_ORGANIZATION_ID {
                return Err(MembersRepositoryError::Forbidden);
            }
            if update.target_user_id == update.actor_id && update.role != MemberRole::Owner {
                return Err(MembersRepositoryError::LastOwner);
            }
            Ok(Member {
                user_id: update.target_user_id,
                email: "member@example.com".to_owned(),
                display_name: "Member".to_owned(),
                role: update.role,
                joined_at: OffsetDateTime::UNIX_EPOCH,
            })
        }

        async fn remove_member(&self, removal: RemoveMember) -> Result<(), MembersRepositoryError> {
            if removal.organization_id != TEST_ORGANIZATION_ID {
                return Err(MembersRepositoryError::Forbidden);
            }
            if removal.target_user_id == removal.actor_id {
                return Err(MembersRepositoryError::LastOwner);
            }
            Ok(())
        }
    }

    #[async_trait]
    impl InvitationsRepository for TestInvitationsRepository {
        async fn create_invitation(
            &self,
            invitation: NewInvitation,
        ) -> Result<Invitation, InvitationsRepositoryError> {
            let stored = Invitation {
                id: invitation.id,
                organization_id: invitation.organization_id,
                email: invitation.email.as_str().to_owned(),
                role: invitation.role,
                state: InvitationState::Pending,
                invited_by: Some(invitation.invited_by),
                accepted_by: None,
                created_at: invitation.created_at,
                expires_at: invitation.expires_at,
                resolved_at: None,
            };
            self.invitations
                .lock()
                .unwrap()
                .push((stored.clone(), invitation.token_digest));
            Ok(stored)
        }

        async fn list_invitations(
            &self,
            request: ListInvitations,
        ) -> Result<Vec<Invitation>, InvitationsRepositoryError> {
            if request.organization_id != TEST_ORGANIZATION_ID {
                return Err(InvitationsRepositoryError::Forbidden);
            }
            Ok(self
                .invitations
                .lock()
                .unwrap()
                .iter()
                .map(|(invitation, _)| invitation)
                .filter(|invitation| {
                    invitation.state == InvitationState::Pending
                        && invitation.expires_at > request.now
                })
                .cloned()
                .collect())
        }

        async fn revoke_invitation(
            &self,
            request: RevokeInvitation,
        ) -> Result<(), InvitationsRepositoryError> {
            let mut invitations = self.invitations.lock().unwrap();
            let invitation = invitations
                .iter_mut()
                .map(|(invitation, _)| invitation)
                .find(|invitation| {
                    invitation.organization_id == request.organization_id
                        && invitation.id == request.invitation_id
                        && invitation.state == InvitationState::Pending
                })
                .ok_or(InvitationsRepositoryError::NotFound)?;
            invitation.state = InvitationState::Revoked;
            invitation.resolved_at = Some(request.revoked_at);
            Ok(())
        }

        async fn accept_invitation(
            &self,
            request: AcceptInvitation,
        ) -> Result<AcceptedInvitation, InvitationsRepositoryError> {
            let mut invitations = self.invitations.lock().unwrap();
            let invitation = invitations
                .iter_mut()
                .find(|(_, digest)| *digest == request.token_digest)
                .map(|(invitation, _)| invitation)
                .ok_or(InvitationsRepositoryError::NotFound)?;
            if invitation.state == InvitationState::Accepted
                && invitation.accepted_by == Some(request.actor_id)
            {
                return Ok(AcceptedInvitation {
                    invitation_id: invitation.id,
                    organization_id: invitation.organization_id,
                    user_id: request.actor_id,
                    role: invitation.role,
                    replayed: true,
                });
            }
            if invitation.state != InvitationState::Pending {
                return Err(InvitationsRepositoryError::NotFound);
            }
            if invitation.email != request.actor_email.as_str() {
                return Err(InvitationsRepositoryError::WrongRecipient);
            }
            invitation.state = InvitationState::Accepted;
            invitation.accepted_by = Some(request.actor_id);
            invitation.resolved_at = Some(request.accepted_at);
            Ok(AcceptedInvitation {
                invitation_id: invitation.id,
                organization_id: invitation.organization_id,
                user_id: request.actor_id,
                role: invitation.role,
                replayed: false,
            })
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

        async fn update_display_name(
            &self,
            user_id: Uuid,
            display_name: zipship_auth::DisplayName,
            _updated_at: OffsetDateTime,
        ) -> Result<StoredUser, AuthRepositoryError> {
            let mut state = self.state.lock().unwrap();
            let user = state
                .users
                .iter_mut()
                .find(|user| user.id == user_id)
                .ok_or(AuthRepositoryError::UserNotFound)?;
            user.display_name = display_name;
            Ok(user.clone())
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
        let audit = AuditService::new(Arc::new(TestAuditRepository));
        let invitations = InvitationsService::new(Arc::new(TestInvitationsRepository::default()));
        let members = MembersService::new(Arc::new(TestMembersRepository));
        let projects = ProjectsService::new(Arc::new(TestProjectsRepository::default()));
        let deployments = DeploymentsService::new(Arc::new(TestDeploymentsRepository::default()));
        let releases = ReleasesService::new(Arc::new(TestReleasesRepository));
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
            AppServices {
                auth,
                audit,
                deployments,
                invitations,
                members,
                projects,
                releases,
                uploads,
            },
            storage.clone(),
            BrowserPolicy::new(
                CookiePolicy::new(secure_cookies),
                CorsPolicy::try_new(vec!["http://127.0.0.1:4015".to_owned()]).unwrap(),
            ),
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
    async fn cors_allows_only_configured_credentialed_console_origins() {
        let app = test_app(CheckStatus::Ok, false).await;
        let preflight = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::OPTIONS)
                    .uri("/_api/projects/project/releases/release/publish")
                    .header(header::ORIGIN, "http://127.0.0.1:4015")
                    .header(header::ACCESS_CONTROL_REQUEST_METHOD, "POST")
                    .header(
                        header::ACCESS_CONTROL_REQUEST_HEADERS,
                        "content-type,idempotency-key,x-csrf-token",
                    )
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(preflight.status(), StatusCode::OK);
        assert_eq!(
            preflight.headers()[header::ACCESS_CONTROL_ALLOW_ORIGIN],
            "http://127.0.0.1:4015"
        );
        assert_eq!(
            preflight.headers()[header::ACCESS_CONTROL_ALLOW_CREDENTIALS],
            "true"
        );

        let rejected = app
            .oneshot(
                Request::get("/_health/live")
                    .header(header::ORIGIN, "https://untrusted.example")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(rejected.status(), StatusCode::OK);
        assert!(
            rejected
                .headers()
                .get(header::ACCESS_CONTROL_ALLOW_ORIGIN)
                .is_none()
        );
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
        const OPENAPI_MAX_BYTES: usize = 256 * 1_024;
        let body = to_bytes(response.into_body(), OPENAPI_MAX_BYTES)
            .await
            .unwrap();
        assert!(body.len() < OPENAPI_MAX_BYTES);
        let document: Value = serde_json::from_slice(&body).unwrap();
        assert!(document["paths"]["/_api/auth/register"].is_object());
        assert!(document["paths"]["/_api/auth/logout"].is_object());
        assert!(
            document["paths"]["/_api/projects/{project_id}/releases/{release_id}/publish"]
                .is_object()
        );
        assert!(document["paths"]["/_api/projects/{project_id}/deployments"].is_object());
        assert!(document["paths"]["/_api/projects/{project_id}/releases"].is_object());
        assert!(document["paths"]["/_api/organizations"].is_object());
        assert!(
            document["paths"]["/_api/organizations/{organization_id}/members/{user_id}"]
                .is_object()
        );
        assert!(document["paths"]["/_api/projects/{project_id}"].is_object());
        assert!(document["paths"]["/_api/projects/{project_id}/uploads"].is_object());
        assert!(document["paths"]["/_api/uploads/{upload_id}/content"].is_object());
    }

    #[test]
    fn committed_openapi_snapshot_matches_the_rust_contract() {
        let expected: Value = serde_json::from_str(include_str!(
            "../../../packages/api-client/openapi/zipship.json"
        ))
        .unwrap();
        let actual = serde_json::to_value(openapi_document()).unwrap();
        assert_eq!(
            actual, expected,
            "Rust API contract changed; run `bun run api:generate`"
        );
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
    async fn profile_update_requires_csrf_and_refreshes_the_current_user() {
        let app = test_app(CheckStatus::Ok, false).await;
        let registered = app.clone().oneshot(register_request()).await.unwrap();
        let session = response_cookie(&registered, "zipship_session");
        let csrf = response_cookie(&registered, "zipship_csrf");
        let cookie_header = format!("{}; {}", cookie_pair(&session), cookie_pair(&csrf));
        let body = json!({ "displayName": "  Product Owner  " }).to_string();

        let missing_csrf = app
            .clone()
            .oneshot(
                Request::patch("/_api/auth/me")
                    .header(header::COOKIE, &cookie_header)
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(body.clone()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(missing_csrf.status(), StatusCode::FORBIDDEN);
        assert_eq!(
            json_body(missing_csrf).await,
            json!({ "code": "INVALID_CSRF_TOKEN" })
        );

        let updated = app
            .clone()
            .oneshot(
                Request::patch("/_api/auth/me")
                    .header(header::COOKIE, &cookie_header)
                    .header(header::CONTENT_TYPE, "application/json")
                    .header("x-csrf-token", cookie_value(&csrf))
                    .body(Body::from(body))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(updated.status(), StatusCode::OK);
        assert_eq!(updated.headers()[header::CACHE_CONTROL], "no-store");
        let updated = json_body(updated).await;
        assert_eq!(updated["user"]["displayName"], "Product Owner");
        assert_eq!(updated["user"]["email"], "owner@example.com");

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
        assert_eq!(
            json_body(current).await["user"]["displayName"],
            "Product Owner"
        );

        let invalid = app
            .oneshot(
                Request::patch("/_api/auth/me")
                    .header(header::COOKIE, cookie_header)
                    .header(header::CONTENT_TYPE, "application/json")
                    .header("x-csrf-token", cookie_value(&csrf))
                    .body(Body::from(json!({ "displayName": " " }).to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(invalid.status(), StatusCode::UNPROCESSABLE_ENTITY);
        assert_eq!(
            json_body(invalid).await,
            json!({ "code": "INVALID_DISPLAY_NAME" })
        );
    }

    #[tokio::test]
    async fn member_mutations_require_csrf_and_preserve_the_last_owner() {
        let app = test_app(CheckStatus::Ok, false).await;
        let registered = app.clone().oneshot(register_request()).await.unwrap();
        let session = response_cookie(&registered, "zipship_session");
        let csrf = response_cookie(&registered, "zipship_csrf");
        let actor_id = json_body(registered).await["user"]["id"]
            .as_str()
            .unwrap()
            .to_owned();
        let cookie_header = format!("{}; {}", cookie_pair(&session), cookie_pair(&csrf));
        let target_user_id = Uuid::from_u128(2);
        let path = format!("/_api/organizations/{TEST_ORGANIZATION_ID}/members/{target_user_id}");
        let body = json!({ "role": "admin" }).to_string();

        let missing_csrf = app
            .clone()
            .oneshot(
                Request::patch(&path)
                    .header(header::COOKIE, &cookie_header)
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(body.clone()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(missing_csrf.status(), StatusCode::FORBIDDEN);
        assert_eq!(
            json_body(missing_csrf).await,
            json!({ "code": "INVALID_CSRF_TOKEN" })
        );

        let updated = app
            .clone()
            .oneshot(
                Request::patch(&path)
                    .header(header::COOKIE, &cookie_header)
                    .header(header::CONTENT_TYPE, "application/json")
                    .header("x-csrf-token", cookie_value(&csrf))
                    .body(Body::from(body))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(updated.status(), StatusCode::OK);
        let updated = json_body(updated).await;
        assert_eq!(updated["member"]["userId"], target_user_id.to_string());
        assert_eq!(updated["member"]["role"], "admin");

        let listed = app
            .clone()
            .oneshot(
                Request::get(format!(
                    "/_api/organizations/{TEST_ORGANIZATION_ID}/members"
                ))
                .header(header::COOKIE, &cookie_header)
                .body(Body::empty())
                .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(listed.status(), StatusCode::OK);
        assert_eq!(json_body(listed).await["members"][0]["role"], "owner");

        let missing_remove_csrf = app
            .clone()
            .oneshot(
                Request::delete(&path)
                    .header(header::COOKIE, &cookie_header)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(missing_remove_csrf.status(), StatusCode::FORBIDDEN);
        assert_eq!(
            json_body(missing_remove_csrf).await,
            json!({ "code": "INVALID_CSRF_TOKEN" })
        );

        let invalid_target = app
            .clone()
            .oneshot(
                Request::delete(format!(
                    "/_api/organizations/{TEST_ORGANIZATION_ID}/members/not-a-uuid"
                ))
                .header(header::COOKIE, &cookie_header)
                .header("x-csrf-token", cookie_value(&csrf))
                .body(Body::empty())
                .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(invalid_target.status(), StatusCode::BAD_REQUEST);
        assert_eq!(
            json_body(invalid_target).await,
            json!({ "code": "INVALID_PATH_PARAMETER" })
        );

        let removed = app
            .clone()
            .oneshot(
                Request::delete(&path)
                    .header(header::COOKIE, &cookie_header)
                    .header("x-csrf-token", cookie_value(&csrf))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(removed.status(), StatusCode::NO_CONTENT);
        assert_eq!(removed.headers()[header::CACHE_CONTROL], "no-store");
        assert!(
            to_bytes(removed.into_body(), usize::MAX)
                .await
                .unwrap()
                .is_empty()
        );

        let last_owner = app
            .clone()
            .oneshot(
                Request::patch(format!(
                    "/_api/organizations/{TEST_ORGANIZATION_ID}/members/{actor_id}"
                ))
                .header(header::COOKIE, &cookie_header)
                .header(header::CONTENT_TYPE, "application/json")
                .header("x-csrf-token", cookie_value(&csrf))
                .body(Body::from(json!({ "role": "viewer" }).to_string()))
                .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(last_owner.status(), StatusCode::CONFLICT);
        assert_eq!(json_body(last_owner).await, json!({ "code": "LAST_OWNER" }));

        let remove_last_owner = app
            .oneshot(
                Request::delete(format!(
                    "/_api/organizations/{TEST_ORGANIZATION_ID}/members/{actor_id}"
                ))
                .header(header::COOKIE, cookie_header)
                .header("x-csrf-token", cookie_value(&csrf))
                .body(Body::empty())
                .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(remove_last_owner.status(), StatusCode::CONFLICT);
        assert_eq!(
            json_body(remove_last_owner).await,
            json!({ "code": "LAST_OWNER" })
        );
    }

    #[tokio::test]
    async fn invitation_routes_issue_manage_and_accept_one_time_tokens() {
        let app = test_app(CheckStatus::Ok, false).await;
        let registered = app.clone().oneshot(register_request()).await.unwrap();
        let session = response_cookie(&registered, "zipship_session");
        let csrf = response_cookie(&registered, "zipship_csrf");
        let cookie_header = format!("{}; {}", cookie_pair(&session), cookie_pair(&csrf));
        let collection_path = format!("/_api/organizations/{TEST_ORGANIZATION_ID}/invitations");
        let invitation_body = json!({
            "email": "owner@example.com",
            "role": "developer"
        })
        .to_string();

        let missing_csrf = app
            .clone()
            .oneshot(
                Request::post(&collection_path)
                    .header(header::COOKIE, &cookie_header)
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(invitation_body.clone()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(missing_csrf.status(), StatusCode::FORBIDDEN);

        let invalid_email = app
            .clone()
            .oneshot(
                Request::post(&collection_path)
                    .header(header::COOKIE, &cookie_header)
                    .header(header::CONTENT_TYPE, "application/json")
                    .header("x-csrf-token", cookie_value(&csrf))
                    .body(Body::from(
                        json!({ "email": "invalid", "role": "viewer" }).to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(invalid_email.status(), StatusCode::UNPROCESSABLE_ENTITY);
        assert_eq!(
            json_body(invalid_email).await,
            json!({ "code": "INVALID_EMAIL" })
        );

        let created = app
            .clone()
            .oneshot(
                Request::post(&collection_path)
                    .header(header::COOKIE, &cookie_header)
                    .header(header::CONTENT_TYPE, "application/json")
                    .header("x-csrf-token", cookie_value(&csrf))
                    .body(Body::from(invitation_body))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(created.status(), StatusCode::CREATED);
        let created = json_body(created).await;
        let token = created["acceptToken"].as_str().unwrap().to_owned();
        assert_eq!(token.len(), 43);
        assert_eq!(created["invitation"]["state"], "pending");
        assert!(created["invitation"].get("acceptToken").is_none());

        let listed = app
            .clone()
            .oneshot(
                Request::get(&collection_path)
                    .header(header::COOKIE, &cookie_header)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(listed.status(), StatusCode::OK);
        let listed = json_body(listed).await;
        assert_eq!(listed["invitations"].as_array().unwrap().len(), 1);
        assert!(listed["invitations"][0].get("acceptToken").is_none());

        let missing_accept_csrf = app
            .clone()
            .oneshot(
                Request::post("/_api/invitations/accept")
                    .header(header::COOKIE, &cookie_header)
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(json!({ "token": token }).to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(missing_accept_csrf.status(), StatusCode::FORBIDDEN);

        for replayed in [false, true] {
            let accepted = app
                .clone()
                .oneshot(
                    Request::post("/_api/invitations/accept")
                        .header(header::COOKIE, &cookie_header)
                        .header(header::CONTENT_TYPE, "application/json")
                        .header("x-csrf-token", cookie_value(&csrf))
                        .body(Body::from(json!({ "token": token }).to_string()))
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(accepted.status(), StatusCode::OK);
            assert_eq!(json_body(accepted).await["replayed"], replayed);
        }

        let second_created = app
            .clone()
            .oneshot(
                Request::post(&collection_path)
                    .header(header::COOKIE, &cookie_header)
                    .header(header::CONTENT_TYPE, "application/json")
                    .header("x-csrf-token", cookie_value(&csrf))
                    .body(Body::from(
                        json!({ "email": "other@example.com", "role": "viewer" }).to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        let second_created = json_body(second_created).await;
        let second_id = second_created["invitation"]["id"].as_str().unwrap();
        let second_token = second_created["acceptToken"].as_str().unwrap();

        let wrong_recipient = app
            .clone()
            .oneshot(
                Request::post("/_api/invitations/accept")
                    .header(header::COOKIE, &cookie_header)
                    .header(header::CONTENT_TYPE, "application/json")
                    .header("x-csrf-token", cookie_value(&csrf))
                    .body(Body::from(json!({ "token": second_token }).to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(wrong_recipient.status(), StatusCode::FORBIDDEN);
        assert_eq!(
            json_body(wrong_recipient).await,
            json!({ "code": "INVITATION_WRONG_RECIPIENT" })
        );

        let revoked = app
            .clone()
            .oneshot(
                Request::delete(format!("{collection_path}/{second_id}"))
                    .header(header::COOKIE, &cookie_header)
                    .header("x-csrf-token", cookie_value(&csrf))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(revoked.status(), StatusCode::NO_CONTENT);

        let revoked_token = app
            .oneshot(
                Request::post("/_api/invitations/accept")
                    .header(header::COOKIE, cookie_header)
                    .header(header::CONTENT_TYPE, "application/json")
                    .header("x-csrf-token", cookie_value(&csrf))
                    .body(Body::from(json!({ "token": second_token }).to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(revoked_token.status(), StatusCode::NOT_FOUND);
        assert_eq!(
            json_body(revoked_token).await,
            json!({ "code": "INVITATION_NOT_FOUND" })
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

        let update_body = json!({
            "name": " Product Site ",
            "slug": " Product-Site ",
            "description": null,
            "spaFallback": false,
            "cachePolicy": "aggressive"
        })
        .to_string();
        let missing_update_csrf = app
            .clone()
            .oneshot(
                Request::patch(format!("/_api/projects/{project_id}"))
                    .header(header::COOKIE, &cookie_header)
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(update_body.clone()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(missing_update_csrf.status(), StatusCode::FORBIDDEN);
        let updated = app
            .clone()
            .oneshot(
                Request::patch(format!("/_api/projects/{project_id}"))
                    .header(header::COOKIE, &cookie_header)
                    .header(header::CONTENT_TYPE, "application/json")
                    .header("x-csrf-token", cookie_value(&csrf))
                    .body(Body::from(update_body))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(updated.status(), StatusCode::OK);
        let updated = json_body(updated).await;
        assert_eq!(updated["project"]["name"], "Product Site");
        assert_eq!(updated["project"]["slug"], "product-site");
        assert!(updated["project"]["description"].is_null());
        assert_eq!(updated["project"]["spaFallback"], false);
        assert_eq!(updated["project"]["cachePolicy"], "aggressive");

        let null_name = app
            .clone()
            .oneshot(
                Request::patch(format!("/_api/projects/{project_id}"))
                    .header(header::COOKIE, &cookie_header)
                    .header(header::CONTENT_TYPE, "application/json")
                    .header("x-csrf-token", cookie_value(&csrf))
                    .body(Body::from(json!({ "name": null }).to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(null_name.status(), StatusCode::UNPROCESSABLE_ENTITY);
        assert_eq!(
            json_body(null_name).await,
            json!({ "code": "INVALID_PROJECT_INPUT" })
        );

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
    async fn release_routes_expose_immutable_metadata_without_storage_paths() {
        let app = test_app(CheckStatus::Ok, false).await;
        let registered = app.clone().oneshot(register_request()).await.unwrap();
        let session = response_cookie(&registered, "zipship_session");
        let csrf = response_cookie(&registered, "zipship_csrf");
        let cookie_header = format!("{}; {}", cookie_pair(&session), cookie_pair(&csrf));
        let project_id = Uuid::from_u128(90);

        let response = app
            .oneshot(
                Request::get(format!("/_api/projects/{project_id}/releases"))
                    .header(header::COOKIE, cookie_header)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let response = json_body(response).await;
        let release = &response["releases"][0];
        assert_eq!(release["state"], "ready");
        assert_eq!(release["isActive"], true);
        assert_eq!(
            release["previewPath"],
            format!("/_sites/marketing/{}/", Uuid::from_u128(91))
        );
        assert_eq!(
            release["artifact"]["manifest"]["files"][0]["path"],
            "index.html"
        );
        assert!(release.get("storageKey").is_none());
        assert!(release.get("storagePath").is_none());
    }

    #[tokio::test]
    async fn audit_routes_expose_safe_cursor_paginated_activity() {
        let app = test_app(CheckStatus::Ok, false).await;
        let registered = app.clone().oneshot(register_request()).await.unwrap();
        let session = response_cookie(&registered, "zipship_session");
        let csrf = response_cookie(&registered, "zipship_csrf");
        let cookie_header = format!("{}; {}", cookie_pair(&session), cookie_pair(&csrf));
        let project_id = Uuid::from_u128(70);
        let path = format!(
            "/_api/organizations/{TEST_ORGANIZATION_ID}/audit-logs?limit=1&projectId={project_id}"
        );

        let response = app
            .clone()
            .oneshot(
                Request::get(path)
                    .header(header::COOKIE, &cookie_header)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let response = json_body(response).await;
        let entry = &response["items"][0];
        assert_eq!(entry["projectId"], project_id.to_string());
        assert_eq!(entry["actor"]["displayName"], "Owner");
        assert_eq!(entry["action"], "release.published");
        assert_eq!(entry["metadata"]["versionNumber"], 2);
        assert!(entry.get("ipAddress").is_none());
        assert!(entry.get("userAgent").is_none());
        assert!(response["nextCursor"].is_null());

        let invalid = app
            .oneshot(
                Request::get(format!(
                    "/_api/organizations/{TEST_ORGANIZATION_ID}/audit-logs?limit=0"
                ))
                .header(header::COOKIE, cookie_header)
                .body(Body::empty())
                .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(invalid.status(), StatusCode::UNPROCESSABLE_ENTITY);
        assert_eq!(
            json_body(invalid).await,
            json!({ "code": "INVALID_AUDIT_QUERY" })
        );
    }

    #[tokio::test]
    async fn deployment_routes_require_csrf_and_idempotency_and_list_history() {
        let app = test_app(CheckStatus::Ok, false).await;
        let registered = app.clone().oneshot(register_request()).await.unwrap();
        let session = response_cookie(&registered, "zipship_session");
        let csrf = response_cookie(&registered, "zipship_csrf");
        let cookie_header = format!("{}; {}", cookie_pair(&session), cookie_pair(&csrf));
        let project_id = Uuid::from_u128(80);
        let release_id = Uuid::from_u128(81);
        let publish_path = format!("/_api/projects/{project_id}/releases/{release_id}/publish");
        let body = json!({ "message": " Production release " }).to_string();

        let missing_csrf = app
            .clone()
            .oneshot(
                Request::post(&publish_path)
                    .header(header::COOKIE, &cookie_header)
                    .header(header::CONTENT_TYPE, "application/json")
                    .header("idempotency-key", "publish-81")
                    .body(Body::from(body.clone()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(missing_csrf.status(), StatusCode::FORBIDDEN);

        let missing_idempotency_key = app
            .clone()
            .oneshot(
                Request::post(&publish_path)
                    .header(header::COOKIE, &cookie_header)
                    .header(header::CONTENT_TYPE, "application/json")
                    .header("x-csrf-token", cookie_value(&csrf))
                    .body(Body::from(body.clone()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(
            missing_idempotency_key.status(),
            StatusCode::UNPROCESSABLE_ENTITY
        );
        assert_eq!(
            json_body(missing_idempotency_key).await,
            json!({ "code": "INVALID_DEPLOYMENT_INPUT" }),
        );

        let published = app
            .clone()
            .oneshot(
                Request::post(&publish_path)
                    .header(header::COOKIE, &cookie_header)
                    .header(header::CONTENT_TYPE, "application/json")
                    .header("x-csrf-token", cookie_value(&csrf))
                    .header("idempotency-key", "publish-81")
                    .header("x-request-id", Uuid::from_u128(82).to_string())
                    .body(Body::from(body))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(published.status(), StatusCode::OK);
        assert_eq!(published.headers()[header::CACHE_CONTROL], "no-store");
        let published = json_body(published).await;
        assert_eq!(published["deployment"]["action"], "publish");
        assert_eq!(published["deployment"]["message"], "Production release");
        assert_eq!(published["activeReleaseId"], release_id.to_string());
        assert_eq!(published["replayed"], false);

        let rollback_path = format!("/_api/projects/{project_id}/releases/{release_id}/rollback");
        let rolled_back = app
            .clone()
            .oneshot(
                Request::post(rollback_path)
                    .header(header::COOKIE, &cookie_header)
                    .header(header::CONTENT_TYPE, "application/json")
                    .header("x-csrf-token", cookie_value(&csrf))
                    .header("idempotency-key", "rollback-81")
                    .body(Body::from("{}"))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(rolled_back.status(), StatusCode::OK);
        assert_eq!(
            json_body(rolled_back).await["deployment"]["action"],
            "rollback"
        );

        let history = app
            .oneshot(
                Request::get(format!("/_api/projects/{project_id}/deployments"))
                    .header(header::COOKIE, cookie_header)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(history.status(), StatusCode::OK);
        let history = json_body(history).await;
        assert_eq!(history["deployments"].as_array().unwrap().len(), 2);
        assert_eq!(history["deployments"][0]["action"], "rollback");
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
