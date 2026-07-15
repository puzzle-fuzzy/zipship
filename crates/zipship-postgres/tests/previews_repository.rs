use serde_json::json;
use sqlx::{PgPool, postgres::PgPoolOptions};
use uuid::Uuid;
use zipship_access::PreviewRepository;
use zipship_domain::ProjectSlug;
use zipship_postgres::PgPreviewRepository;

#[tokio::test]
#[ignore = "requires an isolated PostgreSQL database"]
async fn resolves_fixed_and_active_ready_release_and_artifact_pairs() {
    let pool = test_pool().await;
    zipship_postgres::migrate(&pool).await.unwrap();
    sqlx::query("TRUNCATE TABLE organizations, users, artifacts CASCADE")
        .execute(&pool)
        .await
        .unwrap();
    let fixture = insert_ready_release(&pool).await;
    let repository = PgPreviewRepository::new(pool.clone());
    let slug = ProjectSlug::parse("preview-site").unwrap();

    assert!(
        repository
            .find_active_release(&slug)
            .await
            .unwrap()
            .is_none()
    );

    let release = repository
        .find_ready_release(&slug, fixture.release_id)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(release.release_id(), fixture.release_id);
    assert_eq!(release.project_slug().as_str(), "preview-site");
    assert!(release.spa_fallback());
    assert_eq!(
        release
            .resolve_asset("assets/app.js", false)
            .unwrap()
            .unwrap()
            .size,
        18
    );

    sqlx::query("INSERT INTO project_active_releases (project_id, release_id) VALUES ($1, $2)")
        .bind(fixture.project_id)
        .bind(fixture.release_id)
        .execute(&pool)
        .await
        .unwrap();
    let active = repository
        .find_active_release(&slug)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(active.release_id(), fixture.release_id);

    sqlx::query("UPDATE releases SET state = 'archived' WHERE id = $1")
        .bind(fixture.release_id)
        .execute(&pool)
        .await
        .unwrap();
    assert!(
        repository
            .find_ready_release(&slug, fixture.release_id)
            .await
            .unwrap()
            .is_none()
    );
    assert!(
        repository
            .find_active_release(&slug)
            .await
            .unwrap()
            .is_none()
    );
}

struct Fixture {
    project_id: Uuid,
    release_id: Uuid,
}

async fn insert_ready_release(pool: &PgPool) -> Fixture {
    let user_id = Uuid::new_v4();
    let organization_id = Uuid::new_v4();
    let project_id = Uuid::new_v4();
    let artifact_id = Uuid::new_v4();
    let release_id = Uuid::new_v4();
    let digest = "ab".repeat(32);
    sqlx::query(
        r#"
        INSERT INTO users (id, email, display_name, password_hash)
        VALUES ($1, 'preview@example.com', 'Preview Owner', 'test')
        "#,
    )
    .bind(user_id)
    .execute(pool)
    .await
    .unwrap();
    sqlx::query("INSERT INTO organizations (id, name, slug) VALUES ($1, 'Preview', 'preview')")
        .bind(organization_id)
        .execute(pool)
        .await
        .unwrap();
    sqlx::query(
        r#"
        INSERT INTO projects (id, organization_id, name, slug, created_by)
        VALUES ($1, $2, 'Preview Site', 'preview-site', $3)
        "#,
    )
    .bind(project_id)
    .bind(organization_id)
    .bind(user_id)
    .execute(pool)
    .await
    .unwrap();
    let manifest = json!({
        "version": 1,
        "files": [
            { "path": "assets/app.js", "size": 18, "sha256": "11".repeat(32) },
            { "path": "index.html", "size": 13, "sha256": "22".repeat(32) }
        ]
    });
    sqlx::query(
        r#"
        INSERT INTO artifacts (
            id, sha256, storage_key, state, file_count, total_size, manifest, ready_at
        )
        VALUES ($1, $2, $3, 'ready', 2, 31, $4, now())
        "#,
    )
    .bind(artifact_id)
    .bind(&digest)
    .bind(format!("blobs/sha256/ab/ab/{digest}"))
    .bind(manifest)
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
    .bind(release_id)
    .bind(project_id)
    .bind(artifact_id)
    .bind(user_id)
    .execute(pool)
    .await
    .unwrap();

    Fixture {
        project_id,
        release_id,
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
