use serde_json::json;
use sqlx::{PgPool, postgres::PgPoolOptions};
use uuid::Uuid;
use zipship_audit::{AuditPageRequest, AuditRepository, AuditRepositoryError};
use zipship_postgres::PgAuditRepository;

#[tokio::test]
#[ignore = "requires an isolated PostgreSQL database"]
async fn paginates_visible_audit_history_with_project_scoping() {
    let pool = test_pool().await;
    zipship_postgres::migrate(&pool).await.unwrap();
    sqlx::query("TRUNCATE TABLE organizations, users CASCADE")
        .execute(&pool)
        .await
        .unwrap();
    let fixture = seed(&pool).await;
    let repository = PgAuditRepository::new(pool);

    let first_page = repository
        .list(AuditPageRequest {
            actor_id: fixture.owner_id,
            organization_id: fixture.organization_id,
            project_id: None,
            cursor: None,
            limit: 2,
        })
        .await
        .unwrap();
    assert_eq!(
        first_page
            .entries
            .iter()
            .map(|entry| entry.id)
            .collect::<Vec<_>>(),
        vec![fixture.newest_id, fixture.other_project_id]
    );
    assert_eq!(first_page.next_cursor, Some(fixture.other_project_id));
    let newest = &first_page.entries[0];
    assert_eq!(newest.actor.as_ref().unwrap().display_name, "Audit Owner");
    assert_eq!(newest.metadata["versionNumber"], 2);

    let second_page = repository
        .list(AuditPageRequest {
            cursor: first_page.next_cursor,
            actor_id: fixture.owner_id,
            organization_id: fixture.organization_id,
            project_id: None,
            limit: 2,
        })
        .await
        .unwrap();
    assert_eq!(second_page.entries.len(), 2);
    assert_eq!(second_page.entries[0].id, fixture.older_project_id);
    assert_eq!(second_page.next_cursor, None);

    let project_page = repository
        .list(AuditPageRequest {
            actor_id: fixture.owner_id,
            organization_id: fixture.organization_id,
            project_id: Some(fixture.project_id),
            cursor: None,
            limit: 1,
        })
        .await
        .unwrap();
    assert_eq!(project_page.entries[0].id, fixture.newest_id);
    assert_eq!(project_page.next_cursor, Some(fixture.newest_id));
    let project_tail = repository
        .list(AuditPageRequest {
            actor_id: fixture.owner_id,
            organization_id: fixture.organization_id,
            project_id: Some(fixture.project_id),
            cursor: project_page.next_cursor,
            limit: 10,
        })
        .await
        .unwrap();
    assert_eq!(project_tail.entries.len(), 1);
    assert_eq!(project_tail.entries[0].id, fixture.older_project_id);

    assert!(matches!(
        repository
            .list(AuditPageRequest {
                actor_id: fixture.outsider_id,
                organization_id: fixture.organization_id,
                project_id: None,
                cursor: None,
                limit: 10,
            })
            .await,
        Err(AuditRepositoryError::OrganizationNotFound)
    ));
    assert!(matches!(
        repository
            .list(AuditPageRequest {
                actor_id: fixture.owner_id,
                organization_id: fixture.organization_id,
                project_id: Some(fixture.project_id),
                cursor: Some(fixture.other_project_id),
                limit: 10,
            })
            .await,
        Err(AuditRepositoryError::InvalidCursor)
    ));
}

struct Fixture {
    owner_id: Uuid,
    outsider_id: Uuid,
    organization_id: Uuid,
    project_id: Uuid,
    newest_id: Uuid,
    other_project_id: Uuid,
    older_project_id: Uuid,
}

async fn seed(pool: &PgPool) -> Fixture {
    let owner_id = Uuid::new_v4();
    let outsider_id = Uuid::new_v4();
    let organization_id = Uuid::new_v4();
    let project_id = Uuid::new_v4();
    let other_project_id_value = Uuid::new_v4();
    let oldest_id = Uuid::new_v4();
    let older_project_id = Uuid::new_v4();
    let other_project_id = Uuid::new_v4();
    let newest_id = Uuid::new_v4();
    sqlx::query(
        r#"
        INSERT INTO users (id, email, display_name, password_hash)
        VALUES
            ($1, 'audit-owner@example.com', 'Audit Owner', 'test'),
            ($2, 'audit-outsider@example.com', 'Audit Outsider', 'test')
        "#,
    )
    .bind(owner_id)
    .bind(outsider_id)
    .execute(pool)
    .await
    .unwrap();
    sqlx::query("INSERT INTO organizations (id, name, slug) VALUES ($1, 'Audit', 'audit')")
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
        VALUES
            ($1, $3, 'Audit Site', 'audit-site', $4),
            ($2, $3, 'Other Site', 'other-audit-site', $4)
        "#,
    )
    .bind(project_id)
    .bind(other_project_id_value)
    .bind(organization_id)
    .bind(owner_id)
    .execute(pool)
    .await
    .unwrap();
    sqlx::query(
        r#"
        INSERT INTO audit_logs (
            id, organization_id, project_id, actor_id, action,
            target_type, target_id, metadata, created_at
        )
        VALUES
            ($1, $5, NULL, $6, 'organization.created', 'organization', $5, '{}', '2026-07-15 00:00:00+00'),
            ($2, $5, $7, $6, 'release.published', 'release', gen_random_uuid(), $9, '2026-07-15 00:01:00+00'),
            ($3, $5, $8, $6, 'project.created', 'project', $8, '{}', '2026-07-15 00:02:00+00'),
            ($4, $5, $7, $6, 'release.published', 'release', gen_random_uuid(), $10, '2026-07-15 00:03:00+00')
        "#,
    )
    .bind(oldest_id)
    .bind(older_project_id)
    .bind(other_project_id)
    .bind(newest_id)
    .bind(organization_id)
    .bind(owner_id)
    .bind(project_id)
    .bind(other_project_id_value)
    .bind(json!({ "versionNumber": 1 }))
    .bind(json!({ "versionNumber": 2 }))
    .execute(pool)
    .await
    .unwrap();
    Fixture {
        owner_id,
        outsider_id,
        organization_id,
        project_id,
        newest_id,
        other_project_id,
        older_project_id,
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
