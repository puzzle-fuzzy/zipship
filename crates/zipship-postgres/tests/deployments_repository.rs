use sqlx::{PgPool, postgres::PgPoolOptions};
use std::sync::Arc;
use time::OffsetDateTime;
use uuid::Uuid;
use zipship_deployments::{Clock, DeploymentRequest, DeploymentsError, DeploymentsService};
use zipship_postgres::PgDeploymentsRepository;

#[tokio::test]
#[ignore = "requires an isolated PostgreSQL database"]
async fn serializes_idempotent_publish_and_rollback_transitions() {
    let pool = test_pool().await;
    zipship_postgres::migrate(&pool).await.unwrap();
    sqlx::query("TRUNCATE TABLE organizations, users, artifacts, deployments CASCADE")
        .execute(&pool)
        .await
        .unwrap();
    let fixture = seed(&pool).await;
    let service = service(&pool);

    let first = service
        .publish(request(&fixture, fixture.release_a, "publish-a"))
        .await
        .unwrap();
    assert_eq!(first.deployment.previous_release_id, None);
    assert!(!first.replayed);
    let replay = service
        .publish(request(&fixture, fixture.release_a, "publish-a"))
        .await
        .unwrap();
    assert_eq!(replay.deployment.id, first.deployment.id);
    assert!(replay.replayed);
    assert_eq!(deployment_count(&pool).await, 1);

    let conflict = service
        .publish(request(&fixture, fixture.release_b, "publish-a"))
        .await
        .unwrap_err();
    assert_eq!(conflict, DeploymentsError::IdempotencyConflict);
    let second = service
        .publish(request(&fixture, fixture.release_b, "publish-b"))
        .await
        .unwrap();
    assert_eq!(
        second.deployment.previous_release_id,
        Some(fixture.release_a)
    );
    let rollback = service
        .rollback(request(&fixture, fixture.release_a, "rollback-a"))
        .await
        .unwrap();
    assert_eq!(
        rollback.deployment.previous_release_id,
        Some(fixture.release_b)
    );
    assert_eq!(
        active_release(&pool, fixture.project_id).await,
        fixture.release_a
    );

    assert_eq!(
        service
            .rollback(request(
                &fixture,
                fixture.release_c,
                "rollback-never-active"
            ))
            .await
            .unwrap_err(),
        DeploymentsError::ReleaseNotRollbackable
    );
    assert_eq!(
        service
            .publish(request_as(
                &fixture,
                fixture.release_c,
                fixture.developer_id,
                "developer-publish",
            ))
            .await
            .unwrap_err(),
        DeploymentsError::Forbidden
    );
    assert_eq!(
        service
            .publish(request(&fixture, fixture.release_a, "already-active"))
            .await
            .unwrap_err(),
        DeploymentsError::ReleaseAlreadyActive
    );
    assert_eq!(
        service
            .publish(request(&fixture, fixture.failed_release, "failed-release"))
            .await
            .unwrap_err(),
        DeploymentsError::ReleaseNotReady
    );

    let concurrent_key = "publish-c-concurrent";
    let (left, right) = tokio::join!(
        service.publish(request(&fixture, fixture.release_c, concurrent_key)),
        service.publish(request(&fixture, fixture.release_c, concurrent_key)),
    );
    let left = left.unwrap();
    let right = right.unwrap();
    assert_eq!(left.deployment.id, right.deployment.id);
    assert_ne!(left.replayed, right.replayed);
    assert_eq!(
        active_release(&pool, fixture.project_id).await,
        fixture.release_c
    );

    let (to_a, to_b) = tokio::join!(
        service.publish(request(&fixture, fixture.release_a, "concurrent-a")),
        service.publish(request(&fixture, fixture.release_b, "concurrent-b")),
    );
    let to_a = to_a.unwrap();
    let to_b = to_b.unwrap();
    let (first_concurrent, second_concurrent) =
        if to_a.deployment.previous_release_id == Some(fixture.release_c) {
            (&to_a, &to_b)
        } else {
            (&to_b, &to_a)
        };
    assert_eq!(
        second_concurrent.deployment.previous_release_id,
        Some(first_concurrent.deployment.release_id)
    );
    assert_eq!(
        active_release(&pool, fixture.project_id).await,
        second_concurrent.deployment.release_id
    );

    let listed = service
        .list(fixture.deployer_id, fixture.project_id)
        .await
        .unwrap();
    assert_eq!(listed.len() as i64, deployment_count(&pool).await);
    let audit_count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM audit_logs WHERE project_id = $1 AND action IN ('release.published', 'release.rolled_back')",
    )
    .bind(fixture.project_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(audit_count, deployment_count(&pool).await);
}

struct FixedClock;

impl Clock for FixedClock {
    fn now(&self) -> OffsetDateTime {
        OffsetDateTime::UNIX_EPOCH + time::Duration::days(20_000)
    }
}

fn service(pool: &PgPool) -> DeploymentsService {
    DeploymentsService::with_clock(
        Arc::new(PgDeploymentsRepository::new(pool.clone())),
        Arc::new(FixedClock),
    )
}

struct Fixture {
    project_id: Uuid,
    deployer_id: Uuid,
    developer_id: Uuid,
    release_a: Uuid,
    release_b: Uuid,
    release_c: Uuid,
    failed_release: Uuid,
}

fn request(fixture: &Fixture, release_id: Uuid, key: &str) -> DeploymentRequest {
    request_as(fixture, release_id, fixture.deployer_id, key)
}

fn request_as(fixture: &Fixture, release_id: Uuid, actor_id: Uuid, key: &str) -> DeploymentRequest {
    DeploymentRequest {
        project_id: fixture.project_id,
        release_id,
        actor_id,
        idempotency_key: key.to_owned(),
        message: Some("  verified deployment  ".to_owned()),
        request_id: Some(Uuid::new_v4()),
    }
}

async fn seed(pool: &PgPool) -> Fixture {
    let organization_id = Uuid::new_v4();
    let project_id = Uuid::new_v4();
    let deployer_id = insert_user(pool, "deployer@example.com").await;
    let developer_id = insert_user(pool, "developer@example.com").await;
    sqlx::query("INSERT INTO organizations (id, name, slug) VALUES ($1, 'Deploy', 'deploy')")
        .bind(organization_id)
        .execute(pool)
        .await
        .unwrap();
    sqlx::query(
        "INSERT INTO memberships (organization_id, user_id, role) VALUES ($1, $2, 'deployer'), ($1, $3, 'developer')",
    )
    .bind(organization_id)
    .bind(deployer_id)
    .bind(developer_id)
    .execute(pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO projects (id, organization_id, name, slug, created_by) VALUES ($1, $2, 'Deploy Site', 'deploy-site', $3)",
    )
    .bind(project_id)
    .bind(organization_id)
    .bind(deployer_id)
    .execute(pool)
    .await
    .unwrap();
    let release_a = insert_release(pool, project_id, deployer_id, 1, true).await;
    let release_b = insert_release(pool, project_id, deployer_id, 2, true).await;
    let release_c = insert_release(pool, project_id, deployer_id, 3, true).await;
    let failed_release = insert_release(pool, project_id, deployer_id, 4, false).await;
    Fixture {
        project_id,
        deployer_id,
        developer_id,
        release_a,
        release_b,
        release_c,
        failed_release,
    }
}

async fn insert_user(pool: &PgPool, email: &str) -> Uuid {
    let id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO users (id, email, display_name, password_hash) VALUES ($1, $2, 'User', 'test')",
    )
    .bind(id)
    .bind(email)
    .execute(pool)
    .await
    .unwrap();
    id
}

async fn insert_release(
    pool: &PgPool,
    project_id: Uuid,
    actor_id: Uuid,
    version: i32,
    ready: bool,
) -> Uuid {
    let artifact_id = Uuid::new_v4();
    let release_id = Uuid::new_v4();
    let digest = format!("{version:064x}");
    sqlx::query(
        r#"
        INSERT INTO artifacts (id, sha256, storage_key, state, file_count, total_size, manifest, ready_at)
        VALUES ($1, $2, $3, 'ready', 1, 1, '{"version":1,"files":[]}'::jsonb, now())
        "#,
    )
    .bind(artifact_id)
    .bind(&digest)
    .bind(format!("blobs/sha256/{}/{}/{digest}", &digest[0..2], &digest[2..4]))
    .execute(pool)
    .await
    .unwrap();
    sqlx::query(
        r#"
        INSERT INTO releases (id, project_id, artifact_id, version_number, state, created_by, ready_at)
        VALUES ($1, $2, $3, $4, $5, $6, CASE WHEN $5 = 'ready' THEN now() ELSE NULL END)
        "#,
    )
    .bind(release_id)
    .bind(project_id)
    .bind(artifact_id)
    .bind(version)
    .bind(if ready { "ready" } else { "failed" })
    .bind(actor_id)
    .execute(pool)
    .await
    .unwrap();
    release_id
}

async fn active_release(pool: &PgPool, project_id: Uuid) -> Uuid {
    sqlx::query_scalar("SELECT release_id FROM project_active_releases WHERE project_id = $1")
        .bind(project_id)
        .fetch_one(pool)
        .await
        .unwrap()
}

async fn deployment_count(pool: &PgPool) -> i64 {
    sqlx::query_scalar("SELECT count(*) FROM deployments")
        .fetch_one(pool)
        .await
        .unwrap()
}

async fn test_pool() -> PgPool {
    let database_url = std::env::var("ZIPSHIP_TEST_DATABASE_URL")
        .expect("ZIPSHIP_TEST_DATABASE_URL is required for PostgreSQL integration tests");
    PgPoolOptions::new()
        .max_connections(12)
        .connect(&database_url)
        .await
        .unwrap()
}
