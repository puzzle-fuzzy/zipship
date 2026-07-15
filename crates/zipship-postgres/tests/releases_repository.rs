use serde_json::json;
use sqlx::{PgPool, postgres::PgPoolOptions};
use uuid::Uuid;
use zipship_domain::ReleaseStatus;
use zipship_postgres::PgReleasesRepository;
use zipship_releases::{ReleasesRepository, ReleasesRepositoryError};

#[tokio::test]
#[ignore = "requires an isolated PostgreSQL database"]
async fn lists_release_history_without_exposing_other_projects() {
    let pool = test_pool().await;
    zipship_postgres::migrate(&pool).await.unwrap();
    sqlx::query("TRUNCATE TABLE organizations, users, artifacts CASCADE")
        .execute(&pool)
        .await
        .unwrap();
    let fixture = seed(&pool).await;
    let repository = PgReleasesRepository::new(pool);

    let project = repository
        .list_for_project(fixture.project_id, fixture.owner_id)
        .await
        .unwrap();
    assert_eq!(project.project_slug.as_str(), "release-site");
    assert_eq!(project.releases.len(), 3);
    assert_eq!(project.releases[0].version_number, 3);
    assert_eq!(project.releases[0].state, ReleaseStatus::Failed);
    assert_eq!(
        project.releases[0].failure_code.as_deref(),
        Some("INVALID_ARCHIVE")
    );
    assert_eq!(project.releases[1].state, ReleaseStatus::Processing);
    let active = &project.releases[2];
    assert_eq!(active.id, fixture.ready_release_id);
    assert_eq!(active.state, ReleaseStatus::Ready);
    assert!(active.is_active);
    let artifact = active.artifact.as_ref().unwrap();
    assert_eq!(artifact.file_count, 1);
    assert_eq!(artifact.total_size, 4);
    assert_eq!(artifact.manifest.files[0].path, "index.html");
    assert_eq!(artifact.detect_report["entryDirectory"], "dist");

    assert!(matches!(
        repository
            .list_for_project(fixture.project_id, fixture.outsider_id)
            .await,
        Err(ReleasesRepositoryError::ProjectNotFound)
    ));
}

struct Fixture {
    owner_id: Uuid,
    outsider_id: Uuid,
    project_id: Uuid,
    ready_release_id: Uuid,
}

async fn seed(pool: &PgPool) -> Fixture {
    let owner_id = Uuid::new_v4();
    let outsider_id = Uuid::new_v4();
    let organization_id = Uuid::new_v4();
    let project_id = Uuid::new_v4();
    let artifact_id = Uuid::new_v4();
    let ready_release_id = Uuid::new_v4();
    sqlx::query(
        r#"
        INSERT INTO users (id, email, display_name, password_hash)
        VALUES
            ($1, 'release-owner@example.com', 'Release Owner', 'test'),
            ($2, 'release-outsider@example.com', 'Release Outsider', 'test')
        "#,
    )
    .bind(owner_id)
    .bind(outsider_id)
    .execute(pool)
    .await
    .unwrap();
    sqlx::query("INSERT INTO organizations (id, name, slug) VALUES ($1, 'Release', 'release')")
        .bind(organization_id)
        .execute(pool)
        .await
        .unwrap();
    sqlx::query(
        "INSERT INTO memberships (organization_id, user_id, role) VALUES ($1, $2, 'owner')",
    )
    .bind(organization_id)
    .bind(owner_id)
    .execute(pool)
    .await
    .unwrap();
    sqlx::query(
        r#"
        INSERT INTO projects (id, organization_id, name, slug, created_by)
        VALUES ($1, $2, 'Release Site', 'release-site', $3)
        "#,
    )
    .bind(project_id)
    .bind(organization_id)
    .bind(owner_id)
    .execute(pool)
    .await
    .unwrap();
    let digest = "ab".repeat(32);
    sqlx::query(
        r#"
        INSERT INTO artifacts (
            id, sha256, storage_key, state, file_count, total_size,
            manifest, detect_report, ready_at
        )
        VALUES ($1, $2, $3, 'ready', 1, 4, $4, $5, now())
        "#,
    )
    .bind(artifact_id)
    .bind(&digest)
    .bind(format!("blobs/sha256/ab/ab/{digest}"))
    .bind(json!({
        "version": 1,
        "files": [{ "path": "index.html", "size": 4, "sha256": "cd".repeat(32) }]
    }))
    .bind(json!({ "entryDirectory": "dist" }))
    .execute(pool)
    .await
    .unwrap();
    sqlx::query(
        r#"
        INSERT INTO releases (
            id, project_id, artifact_id, version_number, state, created_by, ready_at
        )
        VALUES ($1, $2, $3, 1, 'ready', $4, now())
        "#,
    )
    .bind(ready_release_id)
    .bind(project_id)
    .bind(artifact_id)
    .bind(owner_id)
    .execute(pool)
    .await
    .unwrap();
    sqlx::query(
        r#"
        INSERT INTO releases (project_id, version_number, state, created_by)
        VALUES ($1, 2, 'processing', $2)
        "#,
    )
    .bind(project_id)
    .bind(owner_id)
    .execute(pool)
    .await
    .unwrap();
    sqlx::query(
        r#"
        INSERT INTO releases (project_id, version_number, state, failure_code, created_by)
        VALUES ($1, 3, 'failed', 'INVALID_ARCHIVE', $2)
        "#,
    )
    .bind(project_id)
    .bind(owner_id)
    .execute(pool)
    .await
    .unwrap();
    sqlx::query("INSERT INTO project_active_releases (project_id, release_id) VALUES ($1, $2)")
        .bind(project_id)
        .bind(ready_release_id)
        .execute(pool)
        .await
        .unwrap();
    Fixture {
        owner_id,
        outsider_id,
        project_id,
        ready_release_id,
    }
}

async fn test_pool() -> PgPool {
    let database_url = std::env::var("ZIPSHIP_TEST_DATABASE_URL")
        .expect("ZIPSHIP_TEST_DATABASE_URL is required for PostgreSQL integration tests");
    PgPoolOptions::new()
        .max_connections(4)
        .connect(&database_url)
        .await
        .unwrap()
}
