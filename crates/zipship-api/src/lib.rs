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
use utoipa::{Modify, OpenApi, ToSchema};
use zipship_audit::AuditService;
use zipship_auth::AuthService;
use zipship_deployments::DeploymentsService;
use zipship_invitations::InvitationsService;
use zipship_members::MembersService;
use zipship_projects::ProjectsService;
use zipship_recovery::PasswordRecoveryService;
use zipship_releases::ReleasesService;
use zipship_storage::LocalArtifactStore;
use zipship_tokens::ApiTokensService;
use zipship_uploads::UploadsService;

mod anonymous;
mod audit;
mod auth;
mod deployments;
mod error;
mod invitations;
mod members;
mod projects;
mod recovery;
mod releases;
mod request;
mod tokens;
mod uploads;

pub use anonymous::{AnonymousRequestPolicy, InvalidAnonymousRequestPolicy};
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
                header::AUTHORIZATION,
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
    pub recovery: PasswordRecoveryService,
    pub releases: ReleasesService,
    pub tokens: ApiTokensService,
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
    pub(crate) recovery: PasswordRecoveryService,
    pub(crate) releases: ReleasesService,
    pub(crate) tokens: ApiTokensService,
    pub(crate) uploads: UploadsService,
    pub(crate) storage: LocalArtifactStore,
    pub(crate) cookie_policy: CookiePolicy,
    pub(crate) cors_policy: CorsPolicy,
    pub(crate) anonymous: AnonymousRequestPolicy,
}

impl AppState {
    pub fn new(
        readiness: Arc<dyn ReadinessProbe>,
        services: AppServices,
        storage: LocalArtifactStore,
        browser_policy: BrowserPolicy,
        anonymous: AnonymousRequestPolicy,
    ) -> Self {
        Self {
            readiness,
            auth: services.auth,
            audit: services.audit,
            deployments: services.deployments,
            invitations: services.invitations,
            members: services.members,
            projects: services.projects,
            recovery: services.recovery,
            releases: services.releases,
            tokens: services.tokens,
            uploads: services.uploads,
            storage,
            cookie_policy: browser_policy.cookie_policy,
            cors_policy: browser_policy.cors_policy,
            anonymous,
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
        tokens::create_api_token,
        tokens::list_api_tokens,
        tokens::revoke_api_token,
        recovery::request_password_reset,
        recovery::confirm_password_reset,
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
        tokens::CreateApiTokenRequest,
        tokens::IssuedApiTokenResponse,
        tokens::ApiTokensResponse,
        tokens::ApiTokenResponse,
        tokens::ApiTokenScopeDto,
        tokens::ApiTokenStateDto,
        recovery::RequestPasswordResetRequest,
        recovery::ConfirmPasswordResetRequest,
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
        (name = "api-tokens", description = "Personal scoped API credentials"),
        (name = "audit", description = "Organization activity history"),
        (name = "deployments", description = "Idempotent release activation and rollback"),
        (name = "organizations", description = "Organizations and memberships"),
        (name = "members", description = "Organization member lifecycle"),
        (name = "invitations", description = "Secure organization invitation lifecycle"),
        (name = "projects", description = "Static deployment projects"),
        (name = "releases", description = "Immutable project release history"),
        (name = "uploads", description = "Bounded archive ingestion and processing")
    ),
    modifiers(&SecurityAddon)
)]
pub struct ApiDoc;

struct SecurityAddon;

impl Modify for SecurityAddon {
    fn modify(&self, openapi: &mut utoipa::openapi::OpenApi) {
        use utoipa::openapi::security::{
            ApiKey, ApiKeyValue, Http, HttpAuthScheme, SecurityScheme,
        };

        let components = openapi.components.get_or_insert_default();
        components.add_security_scheme(
            "cookieAuth",
            SecurityScheme::ApiKey(ApiKey::Cookie(ApiKeyValue::new("zipship_session"))),
        );
        components.add_security_scheme(
            "apiToken",
            SecurityScheme::Http(Http::new(HttpAuthScheme::Bearer)),
        );
    }
}

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
        .merge(tokens::router())
        .merge(recovery::router())
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
mod tests;
