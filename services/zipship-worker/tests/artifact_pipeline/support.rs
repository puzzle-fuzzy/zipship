use async_trait::async_trait;
use axum::{
    Router,
    body::{Body, to_bytes},
    extract::ConnectInfo,
    http::{Request, header},
};
use secrecy::SecretString;
use serde_json::{Value, json};
use sqlx::{PgPool, postgres::PgPoolOptions};
use std::{collections::BTreeMap, io::Write, net::SocketAddr, sync::Arc};
use tower::ServiceExt;
use uuid::Uuid;
use zip::{CompressionMethod, ZipWriter, write::SimpleFileOptions};
use zipship_api::{
    AnonymousRequestPolicy, AppServices, AppState, BrowserPolicy, CheckStatus, CookiePolicy,
    CorsPolicy, ReadinessProbe, build_router,
};
use zipship_audit::AuditService;
use zipship_auth::AuthService;
use zipship_deployments::DeploymentsService;
use zipship_invitations::InvitationsService;
use zipship_members::MembersService;
use zipship_postgres::{
    PgApiTokensRepository, PgAuditRepository, PgAuthRepository, PgDeploymentsRepository,
    PgInvitationsRepository, PgMembersRepository, PgPasswordRecoveryRepository,
    PgProjectsRepository, PgUploadsRepository,
};
use zipship_projects::ProjectsService;
use zipship_recovery::{EnvelopeKeyRing, PasswordRecoveryService};
use zipship_releases::ReleasesService;
use zipship_storage::LocalArtifactStore;
use zipship_tokens::ApiTokensService;
use zipship_uploads::{UploadLimits, UploadsService};
use zipship_worker::{ArtifactWorker, WorkOutcome};

struct Probe;

#[async_trait]
impl ReadinessProbe for Probe {
    async fn check(&self) -> BTreeMap<String, CheckStatus> {
        BTreeMap::from([
            ("database".to_owned(), CheckStatus::Ok),
            ("storage".to_owned(), CheckStatus::Ok),
        ])
    }
}

pub(crate) async fn real_app(pool: &PgPool, storage: &LocalArtifactStore) -> Router {
    let auth = AuthService::new(Arc::new(PgAuthRepository::new(pool.clone())))
        .await
        .unwrap();
    let audit = AuditService::new(Arc::new(PgAuditRepository::new(pool.clone())));
    let invitations = InvitationsService::new(Arc::new(PgInvitationsRepository::new(pool.clone())));
    let members = MembersService::new(Arc::new(PgMembersRepository::new(pool.clone())));
    let projects = ProjectsService::new(Arc::new(PgProjectsRepository::new(pool.clone())));
    let recovery = PasswordRecoveryService::new(
        Arc::new(PgPasswordRecoveryRepository::new(pool.clone())),
        recovery_keys(),
    );
    let tokens = ApiTokensService::new(Arc::new(PgApiTokensRepository::new(pool.clone())));
    let deployments = DeploymentsService::new(Arc::new(PgDeploymentsRepository::new(pool.clone())));
    let releases = ReleasesService::new(Arc::new(zipship_postgres::PgReleasesRepository::new(
        pool.clone(),
    )));
    let uploads = UploadsService::new(
        Arc::new(PgUploadsRepository::new(pool.clone())),
        UploadLimits::default(),
    );
    build_router(AppState::new(
        Arc::new(Probe),
        AppServices {
            auth,
            audit,
            deployments,
            invitations,
            members,
            projects,
            recovery,
            releases,
            tokens,
            uploads,
        },
        storage.clone(),
        BrowserPolicy::new(
            CookiePolicy::new(false),
            CorsPolicy::try_new(vec!["http://127.0.0.1:4015".to_owned()]).unwrap(),
        ),
        AnonymousRequestPolicy::direct(),
    ))
}

pub(crate) fn recovery_keys() -> EnvelopeKeyRing {
    EnvelopeKeyRing::from_base64_config(
        "test",
        &SecretString::from("test:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"),
    )
    .unwrap()
}

pub(crate) struct ProcessedUpload {
    pub(crate) upload_id: Uuid,
    pub(crate) release_id: Uuid,
    pub(crate) artifact_id: Uuid,
}

#[allow(clippy::too_many_arguments)]
pub(crate) async fn upload_and_process(
    app: &Router,
    worker: &ArtifactWorker,
    project_id: &str,
    cookie_header: &str,
    csrf: &str,
    filename: &str,
    archive: Vec<u8>,
) -> ProcessedUpload {
    let upload = app
        .clone()
        .oneshot(
            Request::post(format!("/_api/projects/{project_id}/uploads"))
                .header(header::COOKIE, cookie_header)
                .header(header::CONTENT_TYPE, "application/json")
                .header("x-csrf-token", csrf)
                .body(Body::from(
                    json!({
                        "filename": filename,
                        "sizeBytes": archive.len()
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(upload.status(), axum::http::StatusCode::CREATED);
    let upload = json_body(upload).await;
    let upload_id = Uuid::parse_str(upload["upload"]["id"].as_str().unwrap()).unwrap();

    let uploaded = app
        .clone()
        .oneshot(
            Request::put(format!("/_api/uploads/{upload_id}/content"))
                .header(header::COOKIE, cookie_header)
                .header(header::CONTENT_TYPE, "application/zip")
                .header(header::CONTENT_LENGTH, archive.len())
                .header("x-csrf-token", csrf)
                .body(Body::from(archive))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(uploaded.status(), axum::http::StatusCode::OK);
    assert_eq!(json_body(uploaded).await["upload"]["status"], "uploaded");

    let completed = app
        .clone()
        .oneshot(
            Request::post(format!("/_api/uploads/{upload_id}/complete"))
                .header(header::COOKIE, cookie_header)
                .header("x-csrf-token", csrf)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(completed.status(), axum::http::StatusCode::ACCEPTED);
    let completed = json_body(completed).await;
    let release_id = Uuid::parse_str(completed["releaseId"].as_str().unwrap()).unwrap();
    assert_eq!(completed["upload"]["status"], "processing");

    let outcome = worker.process_next().await.unwrap();
    let WorkOutcome::Completed {
        artifact_id,
        cleanup_pending: false,
        ..
    } = outcome
    else {
        panic!("expected the artifact worker to complete, got {outcome:?}");
    };
    let detail = app
        .clone()
        .oneshot(
            Request::get(format!("/_api/uploads/{upload_id}"))
                .header(header::COOKIE, cookie_header)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(detail.status(), axum::http::StatusCode::OK);
    let detail = json_body(detail).await;
    assert_eq!(detail["upload"]["status"], "completed");
    assert_eq!(detail["upload"]["releaseId"], release_id.to_string());

    ProcessedUpload {
        upload_id,
        release_id,
        artifact_id,
    }
}

#[allow(clippy::too_many_arguments)]
pub(crate) async fn deploy_release(
    app: &Router,
    project_id: &str,
    release_id: Uuid,
    action: &str,
    idempotency_key: &str,
    cookie_header: &str,
    csrf: &str,
) -> Value {
    let response = app
        .clone()
        .oneshot(
            Request::post(format!(
                "/_api/projects/{project_id}/releases/{release_id}/{action}"
            ))
            .header(header::COOKIE, cookie_header)
            .header(header::CONTENT_TYPE, "application/json")
            .header("x-csrf-token", csrf)
            .header("idempotency-key", idempotency_key)
            .body(Body::from(
                json!({ "message": format!("E2E {action} {release_id}") }).to_string(),
            ))
            .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), axum::http::StatusCode::OK);
    json_body(response).await
}

pub(crate) fn register_request() -> Request<Body> {
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

pub(crate) fn login_request(password: &str) -> Request<Body> {
    Request::post("/_api/auth/login")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "email": "owner@example.com",
                "password": password
            })
            .to_string(),
        ))
        .unwrap()
}

pub(crate) fn with_peer(mut request: Request<Body>) -> Request<Body> {
    request.extensions_mut().insert(ConnectInfo(
        "192.0.2.90:43100".parse::<SocketAddr>().unwrap(),
    ));
    request
}

pub(crate) fn response_cookie(response: &axum::response::Response, name: &str) -> String {
    response
        .headers()
        .get_all(header::SET_COOKIE)
        .iter()
        .filter_map(|value| value.to_str().ok())
        .find(|value| value.starts_with(&format!("{name}=")))
        .unwrap()
        .to_owned()
}

pub(crate) fn cookie_pair(set_cookie: &str) -> &str {
    set_cookie.split(';').next().unwrap()
}

pub(crate) fn cookie_value(set_cookie: &str) -> &str {
    cookie_pair(set_cookie).split_once('=').unwrap().1
}

pub(crate) async fn json_body(response: axum::response::Response) -> Value {
    serde_json::from_slice(&to_bytes(response.into_body(), 64 * 1_024).await.unwrap()).unwrap()
}

pub(crate) fn site_zip(index_html: &str, script: &str) -> Vec<u8> {
    let mut writer = ZipWriter::new(std::io::Cursor::new(Vec::new()));
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
    writer.start_file("dist/index.html", options).unwrap();
    writer.write_all(index_html.as_bytes()).unwrap();
    writer.start_file("dist/assets/app.js", options).unwrap();
    writer.write_all(script.as_bytes()).unwrap();
    writer.finish().unwrap().into_inner()
}

pub(crate) async fn test_pool() -> PgPool {
    let database_url = std::env::var("ZIPSHIP_TEST_DATABASE_URL")
        .expect("ZIPSHIP_TEST_DATABASE_URL is required for PostgreSQL integration tests");
    PgPoolOptions::new()
        .max_connections(8)
        .connect(&database_url)
        .await
        .unwrap()
}
