use async_trait::async_trait;
use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode, header},
};
use serde_json::{Value, json};
use sqlx::{PgPool, postgres::PgPoolOptions};
use std::{collections::BTreeMap, io::Write, sync::Arc, time::Duration};
use tower::ServiceExt;
use uuid::Uuid;
use zip::{CompressionMethod, ZipWriter, write::SimpleFileOptions};
use zipship_access::PreviewService;
use zipship_api::{AppState, CheckStatus, CookiePolicy, ReadinessProbe, build_router};
use zipship_artifact::ArtifactLimits;
use zipship_auth::AuthService;
use zipship_deployments::DeploymentsService;
use zipship_domain::ArtifactDigest;
use zipship_jobs::{JobLease, WorkerId};
use zipship_postgres::{
    PgArtifactJobsRepository, PgAuthRepository, PgDeploymentsRepository, PgJobsRepository,
    PgPreviewRepository, PgProjectsRepository, PgUploadsRepository,
};
use zipship_projects::ProjectsService;
use zipship_storage::LocalArtifactStore;
use zipship_uploads::{UploadLimits, UploadsService};
use zipship_worker::{ArtifactWorker, WorkOutcome};

#[tokio::test]
#[ignore = "requires an isolated PostgreSQL database"]
async fn processes_and_serves_the_real_http_upload_pipeline() {
    let pool = test_pool().await;
    zipship_postgres::migrate(&pool).await.unwrap();
    sqlx::query("TRUNCATE TABLE organizations, users, artifacts, jobs CASCADE")
        .execute(&pool)
        .await
        .unwrap();
    let temp = tempfile::tempdir().unwrap();
    let storage = LocalArtifactStore::new(temp.path());
    storage.ensure_layout().await.unwrap();
    let app = real_app(&pool, &storage).await;

    let registered = app.clone().oneshot(register_request()).await.unwrap();
    assert_eq!(registered.status(), StatusCode::CREATED);
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
    let organizations = json_body(organizations).await;
    let organization_id = organizations["organizations"][0]["id"].as_str().unwrap();
    let project = app
        .clone()
        .oneshot(
            Request::post(format!("/_api/organizations/{organization_id}/projects"))
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
    assert_eq!(project.status(), StatusCode::CREATED);
    let project = json_body(project).await;
    let project_id = project["project"]["id"].as_str().unwrap();

    let archive = site_zip();
    let upload = app
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
    assert_eq!(upload.status(), StatusCode::CREATED);
    let upload = json_body(upload).await;
    let upload_id = upload["upload"]["id"].as_str().unwrap();
    let upload_uuid = Uuid::parse_str(upload_id).unwrap();

    let uploaded = app
        .clone()
        .oneshot(
            Request::put(format!("/_api/uploads/{upload_id}/content"))
                .header(header::COOKIE, &cookie_header)
                .header(header::CONTENT_TYPE, "application/zip")
                .header(header::CONTENT_LENGTH, archive.len())
                .header("x-csrf-token", cookie_value(&csrf))
                .body(Body::from(archive))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(uploaded.status(), StatusCode::OK);
    assert_eq!(json_body(uploaded).await["upload"]["status"], "uploaded");

    let completed = app
        .clone()
        .oneshot(
            Request::post(format!("/_api/uploads/{upload_id}/complete"))
                .header(header::COOKIE, &cookie_header)
                .header("x-csrf-token", cookie_value(&csrf))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(completed.status(), StatusCode::ACCEPTED);
    let completed = json_body(completed).await;
    let release_id = Uuid::parse_str(completed["releaseId"].as_str().unwrap()).unwrap();
    assert_eq!(completed["upload"]["status"], "processing");

    let worker = ArtifactWorker::new(
        Arc::new(PgJobsRepository::new(pool.clone())),
        Arc::new(PgArtifactJobsRepository::new(pool.clone())),
        storage.clone(),
        WorkerId::parse("artifact-worker-e2e").unwrap(),
        JobLease::parse(Duration::from_secs(60)).unwrap(),
        ArtifactLimits::default(),
    );
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
                .header(header::COOKIE, &cookie_header)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(detail.status(), StatusCode::OK);
    let detail = json_body(detail).await;
    assert_eq!(detail["upload"]["status"], "completed");
    assert_eq!(detail["upload"]["releaseId"], release_id.to_string());

    let persisted: (String, String, String, String) = sqlx::query_as(
        r#"
        SELECT artifacts.sha256, artifacts.storage_key, releases.state, jobs.status
        FROM releases
        INNER JOIN artifacts ON artifacts.id = releases.artifact_id
        INNER JOIN uploads ON uploads.release_id = releases.id
        INNER JOIN jobs ON jobs.domain_id = uploads.id AND jobs.kind = 'artifact.process'
        WHERE releases.id = $1 AND artifacts.id = $2
        "#,
    )
    .bind(release_id)
    .bind(artifact_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(persisted.2, "ready");
    assert_eq!(persisted.3, "succeeded");
    let digest = ArtifactDigest::parse(&persisted.0).unwrap();
    assert_eq!(
        persisted.1,
        LocalArtifactStore::artifact_storage_key(&digest),
    );
    assert_eq!(
        std::fs::read_to_string(storage.artifact_path(&digest).join("index.html")).unwrap(),
        "<main>ZipShip worker ready</main>",
    );
    assert!(!storage.upload_staging_path(upload_uuid).exists());

    let access = zipship_access::build_router(PreviewService::new(
        Arc::new(PgPreviewRepository::new(pool.clone())),
        storage.clone(),
    ));
    let preview_url = format!("/_sites/marketing-site/{release_id}/");
    let preview = access
        .clone()
        .oneshot(Request::get(&preview_url).body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(preview.status(), StatusCode::OK);
    assert_eq!(preview.headers()[header::CACHE_CONTROL], "no-cache");
    assert_eq!(
        preview.headers()[header::CONTENT_TYPE],
        "text/html; charset=utf-8"
    );
    assert_eq!(
        to_bytes(preview.into_body(), 1_024).await.unwrap(),
        "<main>ZipShip worker ready</main>"
    );

    let partial = access
        .clone()
        .oneshot(
            Request::get(format!("{preview_url}assets/app.js"))
                .header(header::RANGE, "bytes=0-6")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(partial.status(), StatusCode::PARTIAL_CONTENT);
    assert_eq!(partial.headers()[header::CONTENT_RANGE], "bytes 0-6/20");
    assert_eq!(to_bytes(partial.into_body(), 16).await.unwrap(), "console");

    let deep_link = access
        .clone()
        .oneshot(
            Request::get(format!("{preview_url}dashboard/settings"))
                .header(header::ACCEPT, "text/html")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(deep_link.status(), StatusCode::OK);
    assert_eq!(
        to_bytes(deep_link.into_body(), 1_024).await.unwrap(),
        "<main>ZipShip worker ready</main>"
    );

    let isolated = access
        .oneshot(
            Request::get("/_api/openapi.json")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(isolated.status(), StatusCode::NOT_FOUND);
}

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

async fn real_app(pool: &PgPool, storage: &LocalArtifactStore) -> Router {
    let auth = AuthService::new(Arc::new(PgAuthRepository::new(pool.clone())))
        .await
        .unwrap();
    let projects = ProjectsService::new(Arc::new(PgProjectsRepository::new(pool.clone())));
    let deployments = DeploymentsService::new(Arc::new(PgDeploymentsRepository::new(pool.clone())));
    let uploads = UploadsService::new(
        Arc::new(PgUploadsRepository::new(pool.clone())),
        UploadLimits::default(),
    );
    build_router(AppState::new(
        Arc::new(Probe),
        auth,
        deployments,
        projects,
        uploads,
        storage.clone(),
        CookiePolicy::new(false),
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
    serde_json::from_slice(&to_bytes(response.into_body(), 64 * 1_024).await.unwrap()).unwrap()
}

fn site_zip() -> Vec<u8> {
    let mut writer = ZipWriter::new(std::io::Cursor::new(Vec::new()));
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
    writer.start_file("dist/index.html", options).unwrap();
    writer
        .write_all(b"<main>ZipShip worker ready</main>")
        .unwrap();
    writer.start_file("dist/assets/app.js", options).unwrap();
    writer.write_all(b"console.log('ready')").unwrap();
    writer.finish().unwrap().into_inner()
}

async fn test_pool() -> PgPool {
    let database_url = std::env::var("ZIPSHIP_TEST_DATABASE_URL")
        .expect("ZIPSHIP_TEST_DATABASE_URL is required for PostgreSQL integration tests");
    PgPoolOptions::new()
        .max_connections(8)
        .connect(&database_url)
        .await
        .unwrap()
}
