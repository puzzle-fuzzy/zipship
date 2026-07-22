use secrecy::SecretString;
use serde_json::json;
use sqlx::{PgPool, postgres::PgPoolOptions};
use std::{sync::Arc, time::Duration};
use time::OffsetDateTime;
use uuid::Uuid;
use zipship_artifact::{
    ArtifactFailureOutcome, ArtifactJobsRepository, ArtifactManifest, ManifestEntry, ReadyArtifact,
    detect_artifact,
};
use zipship_auth::{AuthService, RegisterCommand};
use zipship_domain::{ArtifactDigest, JobKind};
use zipship_jobs::{JobLease, JobsRepository, WorkerId};
use zipship_postgres::{
    PgArtifactJobsRepository, PgAuthRepository, PgJobsRepository, PgProjectsRepository,
    PgUploadsRepository,
};
use zipship_projects::{CreateProjectCommand, ProjectsService};
use zipship_uploads::{
    BeginReceiveResult, CreateUploadCommand, FinalizeResult, UploadLimits, UploadsService,
};

#[tokio::test]
#[ignore = "requires an isolated PostgreSQL database"]
async fn converges_success_reuse_retry_and_terminal_failure_atomically() {
    let pool = test_pool().await;
    zipship_postgres::migrate(&pool).await.unwrap();
    sqlx::query("TRUNCATE TABLE organizations, users, artifacts, jobs CASCADE")
        .execute(&pool)
        .await
        .unwrap();
    let (owner_id, project_id, uploads) = fixture(&pool).await;
    let jobs = PgJobsRepository::new(pool.clone());
    let artifact_jobs = PgArtifactJobsRepository::new(pool.clone());
    let worker = WorkerId::parse("artifact-worker-integration").unwrap();
    let lease = JobLease::parse(Duration::from_secs(60)).unwrap();
    let artifact = ready_artifact();

    let first = create_processing_upload(&uploads, owner_id, project_id).await;
    let first_job = jobs
        .claim_next(&worker, &[JobKind::ArtifactProcess], lease)
        .await
        .unwrap()
        .unwrap();
    let first_context = artifact_jobs
        .load_context(first_job.id, &worker)
        .await
        .unwrap();
    assert_eq!(first_context.upload_id, first.upload_id);
    assert_eq!(first_context.release_id, first.release_id);
    let completed = artifact_jobs
        .complete_artifact_job(&first_context, &worker, &artifact)
        .await
        .unwrap();
    assert!(!completed.reused_artifact);
    assert_ready(
        &pool,
        first.upload_id,
        first.release_id,
        completed.artifact_id,
    )
    .await;
    let stored_report: serde_json::Value =
        sqlx::query_scalar("SELECT detect_report FROM artifacts WHERE id = $1")
            .bind(completed.artifact_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(
        stored_report,
        serde_json::to_value(&artifact.detect_report).unwrap()
    );

    sqlx::query(
        "UPDATE artifacts SET detect_report = jsonb_build_object('entryPoint', 'index.html', 'manifestVersion', 1) WHERE id = $1",
    )
    .bind(completed.artifact_id)
    .execute(&pool)
    .await
    .unwrap();

    let second = create_processing_upload(&uploads, owner_id, project_id).await;
    let second_job = jobs
        .claim_next(&worker, &[JobKind::ArtifactProcess], lease)
        .await
        .unwrap()
        .unwrap();
    let second_context = artifact_jobs
        .load_context(second_job.id, &worker)
        .await
        .unwrap();
    let reused = artifact_jobs
        .complete_artifact_job(&second_context, &worker, &artifact)
        .await
        .unwrap();
    assert!(reused.reused_artifact);
    assert_eq!(reused.artifact_id, completed.artifact_id);
    assert_ready(
        &pool,
        second.upload_id,
        second.release_id,
        reused.artifact_id,
    )
    .await;
    let upgraded_report: serde_json::Value =
        sqlx::query_scalar("SELECT detect_report FROM artifacts WHERE id = $1")
            .bind(reused.artifact_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(upgraded_report["reportVersion"], 1);
    assert_eq!(upgraded_report, stored_report);
    let artifact_count: i64 = sqlx::query_scalar("SELECT count(*) FROM artifacts")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(artifact_count, 1);

    let failed = create_processing_upload(&uploads, owner_id, project_id).await;
    let failure_job = jobs
        .claim_next(&worker, &[JobKind::ArtifactProcess], lease)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        artifact_jobs
            .fail_artifact_job(
                failure_job.id,
                &worker,
                "ARTIFACT_IO_FAILURE",
                &json!({ "recoverable": true }),
                Some(OffsetDateTime::now_utc() - time::Duration::seconds(1)),
            )
            .await
            .unwrap(),
        ArtifactFailureOutcome::RetryScheduled,
    );
    let processing_states: (String, String) = sqlx::query_as(
        r#"
        SELECT uploads.state, releases.state
        FROM uploads
        INNER JOIN releases ON releases.id = uploads.release_id
        WHERE uploads.id = $1
        "#,
    )
    .bind(failed.upload_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        processing_states,
        ("processing".to_owned(), "processing".to_owned())
    );

    let failure_job = jobs
        .claim_next(&worker, &[JobKind::ArtifactProcess], lease)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        artifact_jobs
            .fail_artifact_job(
                failure_job.id,
                &worker,
                "INVALID_ZIP_ARCHIVE",
                &json!({ "recoverable": false }),
                None,
            )
            .await
            .unwrap(),
        ArtifactFailureOutcome::Terminal,
    );
    let failed_states: (String, Option<String>, String, Option<String>, String) = sqlx::query_as(
        r#"
        SELECT
            uploads.state,
            uploads.error_code,
            releases.state,
            releases.failure_code,
            jobs.status
        FROM uploads
        INNER JOIN releases ON releases.id = uploads.release_id
        INNER JOIN jobs ON jobs.domain_id = uploads.id AND jobs.kind = 'artifact.process'
        WHERE uploads.id = $1
        "#,
    )
    .bind(failed.upload_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(failed_states.0, "failed");
    assert_eq!(failed_states.1.as_deref(), Some("INVALID_ZIP_ARCHIVE"));
    assert_eq!(failed_states.2, "failed");
    assert_eq!(failed_states.3.as_deref(), Some("INVALID_ZIP_ARCHIVE"));
    assert_eq!(failed_states.4, "failed");

    let completed_audits: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM audit_logs WHERE action = 'upload.processing_completed'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    let failed_audits: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM audit_logs WHERE action = 'upload.processing_failed'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(completed_audits, 2);
    assert_eq!(failed_audits, 1);
}

struct ProcessingUpload {
    upload_id: Uuid,
    release_id: Uuid,
}

async fn fixture(pool: &PgPool) -> (Uuid, Uuid, UploadsService) {
    let auth = AuthService::new(Arc::new(PgAuthRepository::new(pool.clone())))
        .await
        .unwrap();
    let owner = auth
        .register(RegisterCommand {
            email: "owner@example.com".to_owned(),
            display_name: "Owner".to_owned(),
            password: SecretString::from("correct horse battery staple".to_owned()),
        })
        .await
        .unwrap();
    let projects = ProjectsService::new(Arc::new(PgProjectsRepository::new(pool.clone())));
    let organization_id = projects.list_organizations(owner.user.id).await.unwrap()[0].id;
    let project = projects
        .create_project(CreateProjectCommand {
            actor_id: owner.user.id,
            organization_id,
            name: "Marketing Site".to_owned(),
            slug: "marketing-site".to_owned(),
            description: None,
        })
        .await
        .unwrap();
    let uploads = UploadsService::new(
        Arc::new(PgUploadsRepository::new(pool.clone())),
        UploadLimits::default(),
    );
    (owner.user.id, project.id, uploads)
}

async fn create_processing_upload(
    uploads: &UploadsService,
    actor_id: Uuid,
    project_id: Uuid,
) -> ProcessingUpload {
    let upload = uploads
        .create(CreateUploadCommand {
            actor_id,
            project_id,
            original_filename: "frontend.zip".to_owned(),
            expected_size: 512,
        })
        .await
        .unwrap();
    let lease = match uploads.begin_receive(upload.id, actor_id).await.unwrap() {
        BeginReceiveResult::Started(lease) => lease,
        BeginReceiveResult::AlreadyUploaded(_) => panic!("new upload cannot already be uploaded"),
    };
    uploads.mark_uploaded(&lease, actor_id, 512).await.unwrap();
    let finalized = match uploads.finalize(upload.id, actor_id).await.unwrap() {
        FinalizeResult::Created(finalized) => finalized,
        FinalizeResult::Existing(_) => panic!("new upload cannot already be finalized"),
    };
    ProcessingUpload {
        upload_id: upload.id,
        release_id: finalized.release_id,
    }
}

fn ready_artifact() -> ReadyArtifact {
    let digest = ArtifactDigest::parse("01".repeat(32)).unwrap();
    let manifest = ArtifactManifest {
        version: 1,
        files: vec![ManifestEntry {
            path: "index.html".to_owned(),
            size: 13,
            sha256: "ab".repeat(32),
        }],
    };
    let root = tempfile::tempdir().unwrap();
    std::fs::write(root.path().join("index.html"), "<main></main>").unwrap();
    let detect_report = detect_artifact(root.path(), &manifest).unwrap();
    ReadyArtifact {
        storage_key: format!("blobs/sha256/01/01/{}", digest.as_str(),),
        digest,
        manifest,
        detect_report,
        file_count: 1,
        total_size: 13,
    }
}

async fn assert_ready(pool: &PgPool, upload_id: Uuid, release_id: Uuid, artifact_id: Uuid) {
    let states: (String, String, Option<Uuid>, String) = sqlx::query_as(
        r#"
        SELECT uploads.state, releases.state, releases.artifact_id, jobs.status
        FROM uploads
        INNER JOIN releases ON releases.id = uploads.release_id
        INNER JOIN jobs ON jobs.domain_id = uploads.id AND jobs.kind = 'artifact.process'
        WHERE uploads.id = $1 AND releases.id = $2
        "#,
    )
    .bind(upload_id)
    .bind(release_id)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(states.0, "completed");
    assert_eq!(states.1, "ready");
    assert_eq!(states.2, Some(artifact_id));
    assert_eq!(states.3, "succeeded");
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
