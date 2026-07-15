use async_trait::async_trait;
use axum::{
    Router,
    body::{Body, to_bytes},
    extract::ConnectInfo,
    http::{Request, StatusCode, header},
};
use secrecy::{ExposeSecret, SecretString};
use serde_json::{Value, json};
use sqlx::{PgPool, postgres::PgPoolOptions};
use std::{collections::BTreeMap, io::Write, net::SocketAddr, sync::Arc, time::Duration};
use tower::ServiceExt;
use uuid::Uuid;
use zip::{CompressionMethod, ZipWriter, write::SimpleFileOptions};
use zipship_access::PreviewService;
use zipship_api::{
    AnonymousRequestPolicy, AppServices, AppState, BrowserPolicy, CheckStatus, CookiePolicy,
    CorsPolicy, ReadinessProbe, build_router,
};
use zipship_artifact::ArtifactLimits;
use zipship_audit::AuditService;
use zipship_auth::AuthService;
use zipship_deployments::DeploymentsService;
use zipship_domain::ArtifactDigest;
use zipship_invitations::InvitationsService;
use zipship_jobs::{JobLease, WorkerId};
use zipship_members::MembersService;
use zipship_postgres::{
    PgApiTokensRepository, PgArtifactJobsRepository, PgAuditRepository, PgAuthRepository,
    PgDeploymentsRepository, PgInvitationsRepository, PgJobsRepository, PgMembersRepository,
    PgPasswordRecoveryRepository, PgPreviewRepository, PgProjectsRepository, PgUploadsRepository,
};
use zipship_projects::ProjectsService;
use zipship_recovery::{EnvelopeKeyRing, PasswordRecoveryService};
use zipship_releases::ReleasesService;
use zipship_storage::LocalArtifactStore;
use zipship_tokens::ApiTokensService;
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
    let updated_project = app
        .clone()
        .oneshot(
            Request::patch(format!("/_api/projects/{project_id}"))
                .header(header::COOKIE, &cookie_header)
                .header(header::CONTENT_TYPE, "application/json")
                .header("x-csrf-token", cookie_value(&csrf))
                .body(Body::from(
                    json!({
                        "name": "Marketing Production",
                        "description": "Production frontend",
                        "cachePolicy": "aggressive"
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(updated_project.status(), StatusCode::OK);
    let updated_project = json_body(updated_project).await;
    assert_eq!(updated_project["project"]["name"], "Marketing Production");
    assert_eq!(updated_project["project"]["cachePolicy"], "aggressive");

    let issued_token = app
        .clone()
        .oneshot(
            Request::post("/_api/api-tokens")
                .header(header::COOKIE, &cookie_header)
                .header(header::CONTENT_TYPE, "application/json")
                .header("x-csrf-token", cookie_value(&csrf))
                .body(Body::from(
                    json!({
                        "name": "E2E reader",
                        "scopes": ["projects:read"],
                        "expiresInDays": 30
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(issued_token.status(), StatusCode::CREATED);
    let issued_token = json_body(issued_token).await;
    let token_id = issued_token["apiToken"]["id"].as_str().unwrap();
    let token_secret = issued_token["secret"].as_str().unwrap();
    let bearer_project = app
        .clone()
        .oneshot(
            Request::get(format!("/_api/projects/{project_id}"))
                .header(header::AUTHORIZATION, format!("Bearer {token_secret}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(bearer_project.status(), StatusCode::OK);
    let revoked_token = app
        .clone()
        .oneshot(
            Request::delete(format!("/_api/api-tokens/{token_id}"))
                .header(header::COOKIE, &cookie_header)
                .header("x-csrf-token", cookie_value(&csrf))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(revoked_token.status(), StatusCode::NO_CONTENT);
    let rejected_token = app
        .clone()
        .oneshot(
            Request::get(format!("/_api/projects/{project_id}"))
                .header(header::AUTHORIZATION, format!("Bearer {token_secret}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(rejected_token.status(), StatusCode::UNAUTHORIZED);

    let worker = ArtifactWorker::new(
        Arc::new(PgJobsRepository::new(pool.clone())),
        Arc::new(PgArtifactJobsRepository::new(pool.clone())),
        storage.clone(),
        WorkerId::parse("artifact-worker-e2e").unwrap(),
        JobLease::parse(Duration::from_secs(60)).unwrap(),
        ArtifactLimits::default(),
    );
    let first = upload_and_process(
        &app,
        &worker,
        project_id,
        &cookie_header,
        cookie_value(&csrf),
        "frontend-v1.zip",
        site_zip("<main>ZipShip worker ready</main>", "console.log('ready')"),
    )
    .await;
    let upload_id = first.upload_id;
    let release_id = first.release_id;
    let artifact_id = first.artifact_id;

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
    assert!(!storage.upload_staging_path(upload_id).exists());

    let releases = app
        .clone()
        .oneshot(
            Request::get(format!("/_api/projects/{project_id}/releases"))
                .header(header::COOKIE, &cookie_header)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(releases.status(), StatusCode::OK);
    let releases = json_body(releases).await;
    assert_eq!(releases["releases"][0]["id"], release_id.to_string());
    assert_eq!(releases["releases"][0]["state"], "ready");
    assert_eq!(
        releases["releases"][0]["previewPath"],
        format!("/_sites/marketing-site/{release_id}/")
    );
    assert_eq!(
        releases["releases"][0]["artifact"]["sha256"],
        digest.as_str()
    );
    assert!(releases["releases"][0].get("storageKey").is_none());

    let access = zipship_access::build_router(PreviewService::new(
        Arc::new(PgPreviewRepository::new(pool.clone())),
        storage.clone(),
    ));
    let unpublished = access
        .clone()
        .oneshot(
            Request::get("/marketing-site/")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(unpublished.status(), StatusCode::NOT_FOUND);

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

    let first_publish = deploy_release(
        &app,
        project_id,
        release_id,
        "publish",
        "publish-v1",
        &cookie_header,
        cookie_value(&csrf),
    )
    .await;
    assert_eq!(first_publish["deployment"]["action"], "publish");
    assert_eq!(
        first_publish["deployment"]["previousReleaseId"],
        Value::Null
    );
    assert_eq!(first_publish["activeReleaseId"], release_id.to_string());
    assert_eq!(first_publish["replayed"], false);
    let replayed = deploy_release(
        &app,
        project_id,
        release_id,
        "publish",
        "publish-v1",
        &cookie_header,
        cookie_value(&csrf),
    )
    .await;
    assert_eq!(replayed["replayed"], true);
    assert_eq!(
        replayed["deployment"]["id"],
        first_publish["deployment"]["id"]
    );

    let live_v1 = access
        .clone()
        .oneshot(
            Request::get("/marketing-site/")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(live_v1.status(), StatusCode::OK);
    assert_eq!(
        to_bytes(live_v1.into_body(), 1_024).await.unwrap(),
        "<main>ZipShip worker ready</main>"
    );

    let second = upload_and_process(
        &app,
        &worker,
        project_id,
        &cookie_header,
        cookie_value(&csrf),
        "frontend-v2.zip",
        site_zip(
            "<main>ZipShip second release</main>",
            "console.log('second')",
        ),
    )
    .await;
    assert_ne!(second.release_id, release_id);
    assert_ne!(second.artifact_id, artifact_id);

    let second_preview_url = format!("/_sites/marketing-site/{}/", second.release_id);
    let second_preview = access
        .clone()
        .oneshot(
            Request::get(&second_preview_url)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(second_preview.status(), StatusCode::OK);
    assert_eq!(
        to_bytes(second_preview.into_body(), 1_024).await.unwrap(),
        "<main>ZipShip second release</main>"
    );

    let second_publish = deploy_release(
        &app,
        project_id,
        second.release_id,
        "publish",
        "publish-v2",
        &cookie_header,
        cookie_value(&csrf),
    )
    .await;
    assert_eq!(
        second_publish["deployment"]["previousReleaseId"],
        release_id.to_string()
    );
    let live_v2 = access
        .clone()
        .oneshot(
            Request::get("/marketing-site/")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(live_v2.status(), StatusCode::OK);
    assert_eq!(
        to_bytes(live_v2.into_body(), 1_024).await.unwrap(),
        "<main>ZipShip second release</main>"
    );

    let rollback = deploy_release(
        &app,
        project_id,
        release_id,
        "rollback",
        "rollback-v1",
        &cookie_header,
        cookie_value(&csrf),
    )
    .await;
    assert_eq!(rollback["deployment"]["action"], "rollback");
    assert_eq!(
        rollback["deployment"]["previousReleaseId"],
        second.release_id.to_string()
    );
    assert_eq!(rollback["activeReleaseId"], release_id.to_string());

    let live_rollback = access
        .clone()
        .oneshot(
            Request::get("/marketing-site/")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(live_rollback.status(), StatusCode::OK);
    assert_eq!(
        to_bytes(live_rollback.into_body(), 1_024).await.unwrap(),
        "<main>ZipShip worker ready</main>"
    );
    let immutable_v2 = access
        .clone()
        .oneshot(
            Request::get(second_preview_url)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(immutable_v2.status(), StatusCode::OK);
    assert_eq!(
        to_bytes(immutable_v2.into_body(), 1_024).await.unwrap(),
        "<main>ZipShip second release</main>"
    );

    let history = app
        .clone()
        .oneshot(
            Request::get(format!("/_api/projects/{project_id}/deployments"))
                .header(header::COOKIE, &cookie_header)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(history.status(), StatusCode::OK);
    let history = json_body(history).await;
    assert_eq!(history["deployments"].as_array().unwrap().len(), 3);
    assert_eq!(history["deployments"][0]["action"], "rollback");
    let audit = app
        .clone()
        .oneshot(
            Request::get(format!(
                "/_api/organizations/{organization_id}/audit-logs?projectId={project_id}&limit=100"
            ))
            .header(header::COOKIE, &cookie_header)
            .body(Body::empty())
            .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(audit.status(), StatusCode::OK);
    let audit = json_body(audit).await;
    assert_eq!(audit["items"][0]["action"], "release.rolled_back");
    assert_eq!(
        audit["items"][0]["metadata"]["releaseId"],
        release_id.to_string()
    );
    assert_eq!(
        audit["items"][0]["metadata"]["previousReleaseId"],
        second.release_id.to_string()
    );
    assert!(
        audit["items"]
            .as_array()
            .unwrap()
            .iter()
            .all(|entry| entry["projectId"] == project_id)
    );
    let deployment_count: i64 =
        sqlx::query_scalar("SELECT count(*) FROM deployments WHERE project_id = $1")
            .bind(Uuid::parse_str(project_id).unwrap())
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(deployment_count, 3);

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

#[tokio::test]
#[ignore = "requires an isolated PostgreSQL database"]
async fn resets_a_password_through_the_real_http_and_postgres_pipeline() {
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

    let requested = app
        .clone()
        .oneshot(with_peer(
            Request::post("/_api/auth/password-resets")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    json!({ "email": "owner@example.com" }).to_string(),
                ))
                .unwrap(),
        ))
        .await
        .unwrap();
    assert_eq!(requested.status(), StatusCode::ACCEPTED);

    let (request_id, key_id, nonce, ciphertext) =
        sqlx::query_as::<_, (Uuid, String, Vec<u8>, Vec<u8>)>(
            r#"
            SELECT aggregate_id, key_id, nonce, ciphertext
            FROM email_outbox
            WHERE kind = 'password_reset' AND state = 'queued'
            "#,
        )
        .fetch_one(&pool)
        .await
        .unwrap();
    let delivery = recovery_keys()
        .open_password_reset(
            request_id,
            &zipship_recovery::SealedEnvelope {
                key_id,
                nonce: nonce.try_into().unwrap(),
                ciphertext,
            },
        )
        .unwrap();
    let confirmed = app
        .clone()
        .oneshot(with_peer(
            Request::post("/_api/auth/password-resets/confirm")
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, &cookie_header)
                .body(Body::from(
                    json!({
                        "token": delivery.token.expose_secret(),
                        "password": "replacement correct horse battery staple"
                    })
                    .to_string(),
                ))
                .unwrap(),
        ))
        .await
        .unwrap();
    assert_eq!(confirmed.status(), StatusCode::NO_CONTENT);
    assert!(
        confirmed
            .headers()
            .get_all(header::SET_COOKIE)
            .iter()
            .filter_map(|value| value.to_str().ok())
            .filter(|value| value.to_ascii_lowercase().contains("max-age=0"))
            .count()
            >= 2
    );

    let old_session = app
        .clone()
        .oneshot(
            Request::get("/_api/auth/me")
                .header(header::COOKIE, cookie_pair(&session))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(old_session.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(
        app.clone()
            .oneshot(login_request("correct horse battery staple"))
            .await
            .unwrap()
            .status(),
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        app.oneshot(login_request("replacement correct horse battery staple"))
            .await
            .unwrap()
            .status(),
        StatusCode::OK
    );

    let reset_state =
        sqlx::query_scalar::<_, String>("SELECT state FROM password_reset_requests WHERE id = $1")
            .bind(request_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    let outbox = sqlx::query_as::<_, (String, Option<Vec<u8>>)>(
        "SELECT state, ciphertext FROM email_outbox WHERE aggregate_id = $1",
    )
    .bind(request_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(reset_state, "consumed");
    assert_eq!(outbox, ("cancelled".to_owned(), None));
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

fn recovery_keys() -> EnvelopeKeyRing {
    EnvelopeKeyRing::from_base64_config(
        "test",
        &SecretString::from("test:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"),
    )
    .unwrap()
}

struct ProcessedUpload {
    upload_id: Uuid,
    release_id: Uuid,
    artifact_id: Uuid,
}

#[allow(clippy::too_many_arguments)]
async fn upload_and_process(
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
    assert_eq!(upload.status(), StatusCode::CREATED);
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
    assert_eq!(uploaded.status(), StatusCode::OK);
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
    assert_eq!(completed.status(), StatusCode::ACCEPTED);
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
    assert_eq!(detail.status(), StatusCode::OK);
    let detail = json_body(detail).await;
    assert_eq!(detail["upload"]["status"], "completed");
    assert_eq!(detail["upload"]["releaseId"], release_id.to_string());

    ProcessedUpload {
        upload_id,
        release_id,
        artifact_id,
    }
}

async fn deploy_release(
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
    assert_eq!(response.status(), StatusCode::OK);
    json_body(response).await
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

fn login_request(password: &str) -> Request<Body> {
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

fn with_peer(mut request: Request<Body>) -> Request<Body> {
    request.extensions_mut().insert(ConnectInfo(
        "192.0.2.90:43100".parse::<SocketAddr>().unwrap(),
    ));
    request
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

fn site_zip(index_html: &str, script: &str) -> Vec<u8> {
    let mut writer = ZipWriter::new(std::io::Cursor::new(Vec::new()));
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
    writer.start_file("dist/index.html", options).unwrap();
    writer.write_all(index_html.as_bytes()).unwrap();
    writer.start_file("dist/assets/app.js", options).unwrap();
    writer.write_all(script.as_bytes()).unwrap();
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
