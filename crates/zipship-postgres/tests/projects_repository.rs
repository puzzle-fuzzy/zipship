use secrecy::SecretString;
use sqlx::{PgPool, postgres::PgPoolOptions};
use std::sync::Arc;
use uuid::Uuid;
use zipship_auth::{AuthService, RegisterCommand};
use zipship_domain::MemberRole;
use zipship_postgres::{PgAuthRepository, PgProjectsRepository};
use zipship_projects::{CreateProjectCommand, ProjectsError, ProjectsService};

#[tokio::test]
#[ignore = "requires an isolated PostgreSQL database"]
async fn enforces_membership_and_project_creation_transactions() {
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
    let outsider = auth
        .register(register_command("viewer@example.com", "Viewer"))
        .await
        .unwrap();
    let projects = ProjectsService::new(Arc::new(PgProjectsRepository::new(pool.clone())));
    let organizations = projects.list_organizations(owner.user.id).await.unwrap();
    assert_eq!(organizations.len(), 1);
    assert_eq!(organizations[0].role, MemberRole::Owner);
    let organization_id = organizations[0].id;

    let project = projects
        .create_project(create_command(
            owner.user.id,
            organization_id,
            "marketing-site",
        ))
        .await
        .unwrap();
    assert_eq!(project.slug, "marketing-site");
    assert_eq!(
        projects.get_project(outsider.user.id, project.id).await,
        Err(ProjectsError::NotFound),
    );

    sqlx::query(
        r#"
        INSERT INTO memberships (organization_id, user_id, role)
        VALUES ($1, $2, 'viewer')
        "#,
    )
    .bind(organization_id)
    .bind(outsider.user.id)
    .execute(&pool)
    .await
    .unwrap();
    assert_eq!(
        projects
            .list_projects(outsider.user.id, organization_id)
            .await
            .unwrap()
            .len(),
        1,
    );
    assert_eq!(
        projects
            .create_project(create_command(
                outsider.user.id,
                organization_id,
                "viewer-project",
            ))
            .await,
        Err(ProjectsError::Forbidden),
    );
    assert_eq!(
        projects
            .list_members(owner.user.id, organization_id)
            .await
            .unwrap()
            .len(),
        2,
    );

    let first = projects.create_project(create_command(
        owner.user.id,
        organization_id,
        "concurrent-project",
    ));
    let second = projects.create_project(create_command(
        owner.user.id,
        organization_id,
        "concurrent-project",
    ));
    let (first, second) = tokio::join!(first, second);
    assert!(matches!(
        (first, second),
        (Ok(_), Err(ProjectsError::DuplicateSlug)) | (Err(ProjectsError::DuplicateSlug), Ok(_))
    ));

    let audit_count: i64 = sqlx::query_scalar(
        r#"
        SELECT count(*)
        FROM audit_logs
        WHERE organization_id = $1 AND action = 'project.created'
        "#,
    )
    .bind(organization_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(audit_count, 2);
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

fn create_command(actor_id: Uuid, organization_id: Uuid, slug: &str) -> CreateProjectCommand {
    CreateProjectCommand {
        actor_id,
        organization_id,
        name: "Marketing Site".to_owned(),
        slug: slug.to_owned(),
        description: Some("Campaign frontend".to_owned()),
    }
}
