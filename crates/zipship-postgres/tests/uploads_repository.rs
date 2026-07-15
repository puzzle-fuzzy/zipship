use secrecy::SecretString;
use sqlx::{PgPool, postgres::PgPoolOptions};
use std::sync::Arc;
use uuid::Uuid;
use zipship_auth::{AuthService, RegisterCommand};
use zipship_domain::UploadStatus;
use zipship_postgres::{PgAuthRepository, PgProjectsRepository, PgUploadsRepository};
use zipship_projects::{CreateProjectCommand, ProjectsService};
use zipship_uploads::{
    BeginReceiveResult, CreateUploadCommand, FinalizeResult, UploadLimits, UploadsError,
    UploadsService,
};

#[tokio::test]
#[ignore = "requires an isolated PostgreSQL database"]
async fn persists_retryable_transfers_and_idempotent_processing_jobs() {
    let pool = test_pool().await;
    zipship_postgres::migrate(&pool).await.unwrap();
    sqlx::query("TRUNCATE TABLE organizations, users CASCADE")
        .execute(&pool)
        .await
        .unwrap();

    let auth = AuthService::new(Arc::new(PgAuthRepository::new(pool.clone())))
        .await
        .unwrap();
    let owner = auth
        .register(register_command("owner@example.com", "Owner"))
        .await
        .unwrap();
    let viewer = auth
        .register(register_command("viewer@example.com", "Viewer"))
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
    sqlx::query(
        r#"
        INSERT INTO memberships (organization_id, user_id, role)
        VALUES ($1, $2, 'viewer')
        "#,
    )
    .bind(organization_id)
    .bind(viewer.user.id)
    .execute(&pool)
    .await
    .unwrap();

    let uploads = UploadsService::new(
        Arc::new(PgUploadsRepository::new(pool.clone())),
        UploadLimits::default(),
    );
    assert_eq!(
        uploads
            .create(upload_command(viewer.user.id, project.id))
            .await,
        Err(UploadsError::Forbidden),
    );

    let upload = uploads
        .create(upload_command(owner.user.id, project.id))
        .await
        .unwrap();
    assert_eq!(upload.status, UploadStatus::Pending);
    let first_lease = match uploads
        .begin_receive(upload.id, owner.user.id)
        .await
        .unwrap()
    {
        BeginReceiveResult::Started(lease) => lease,
        BeginReceiveResult::AlreadyUploaded(_) => panic!("a new upload cannot already be uploaded"),
    };
    uploads
        .requeue_interrupted_receive(&first_lease, owner.user.id, "CLIENT_DISCONNECTED")
        .await
        .unwrap();
    let retry_lease = match uploads
        .begin_receive(upload.id, owner.user.id)
        .await
        .unwrap()
    {
        BeginReceiveResult::Started(lease) => lease,
        BeginReceiveResult::AlreadyUploaded(_) => panic!("a retried upload cannot be complete"),
    };
    let uploaded = uploads
        .mark_uploaded(&retry_lease, owner.user.id, 512)
        .await
        .unwrap();
    assert_eq!(uploaded.status, UploadStatus::Uploaded);

    let first = uploads.finalize(upload.id, owner.user.id);
    let second = uploads.finalize(upload.id, owner.user.id);
    let (first, second) = tokio::join!(first, second);
    let (created, existing) = match (first.unwrap(), second.unwrap()) {
        (FinalizeResult::Created(created), FinalizeResult::Existing(existing))
        | (FinalizeResult::Existing(existing), FinalizeResult::Created(created)) => {
            (created, existing)
        }
        result => panic!("expected one created and one existing finalization, got {result:?}"),
    };
    assert_eq!(created.release_id, existing.release_id);
    assert_eq!(created.job_id, existing.job_id);
    assert_eq!(created.upload.status, UploadStatus::Processing);

    let release_count: i64 =
        sqlx::query_scalar("SELECT count(*) FROM releases WHERE project_id = $1")
            .bind(project.id)
            .fetch_one(&pool)
            .await
            .unwrap();
    let job_count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM jobs WHERE kind = 'artifact.process' AND domain_id = $1",
    )
    .bind(upload.id)
    .fetch_one(&pool)
    .await
    .unwrap();
    let audit_count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM audit_logs WHERE action = 'upload.processing_queued' AND target_id = $1",
    )
    .bind(upload.id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(release_count, 1);
    assert_eq!(job_count, 1);
    assert_eq!(audit_count, 1);
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

fn register_command(email: &str, display_name: &str) -> RegisterCommand {
    RegisterCommand {
        email: email.to_owned(),
        display_name: display_name.to_owned(),
        password: SecretString::from("correct horse battery staple".to_owned()),
    }
}

fn upload_command(actor_id: Uuid, project_id: Uuid) -> CreateUploadCommand {
    CreateUploadCommand {
        actor_id,
        project_id,
        original_filename: "frontend.zip".to_owned(),
        expected_size: 512,
    }
}
