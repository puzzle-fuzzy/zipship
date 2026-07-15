use secrecy::{ExposeSecret, SecretString};
use sqlx::postgres::PgPoolOptions;
use std::sync::Arc;
use time::OffsetDateTime;
use zipship_auth::{AuthError, AuthService, RegisterCommand};
use zipship_postgres::PgAuthRepository;

#[tokio::test]
#[ignore = "requires an isolated PostgreSQL database"]
async fn persists_registration_and_revokes_session() {
    let database_url = std::env::var("ZIPSHIP_TEST_DATABASE_URL")
        .expect("ZIPSHIP_TEST_DATABASE_URL is required for the PostgreSQL integration test");
    let pool = PgPoolOptions::new()
        .max_connections(4)
        .connect(&database_url)
        .await
        .unwrap();
    zipship_postgres::migrate(&pool).await.unwrap();
    sqlx::query("TRUNCATE TABLE organizations, users CASCADE")
        .execute(&pool)
        .await
        .unwrap();

    let repository = Arc::new(PgAuthRepository::new(pool.clone()));
    let service = AuthService::new(repository).await.unwrap();
    let outcome = service
        .register(register_command(" Owner@Example.COM "))
        .await
        .unwrap();

    assert_eq!(outcome.user.email, "owner@example.com");
    let stored_digest_size: i32 =
        sqlx::query_scalar("SELECT octet_length(token_hash) FROM web_sessions WHERE id = $1")
            .bind(outcome.session_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(stored_digest_size, 32);

    let duplicate = service
        .register(register_command("OWNER@example.com"))
        .await
        .unwrap_err();
    assert_eq!(duplicate, AuthError::DuplicateEmail);
    let user_count: i64 = sqlx::query_scalar("SELECT count(*) FROM users")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(user_count, 1);
    let owner_membership_count: i64 = sqlx::query_scalar(
        r#"
        SELECT count(*)
        FROM memberships
        WHERE user_id = $1 AND role = 'owner'
        "#,
    )
    .bind(outcome.user.id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(owner_membership_count, 1);
    let organization_audit_count: i64 = sqlx::query_scalar(
        r#"
        SELECT count(*)
        FROM audit_logs
        WHERE actor_id = $1 AND action = 'organization.created'
        "#,
    )
    .bind(outcome.user.id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(organization_audit_count, 1);

    let token = outcome.credentials.session_token().expose_secret();
    let session = service.authenticate(token).await.unwrap();
    assert_eq!(session.profile(), outcome.user);
    let initial_updated_at: OffsetDateTime =
        sqlx::query_scalar("SELECT updated_at FROM users WHERE id = $1")
            .bind(outcome.user.id)
            .fetch_one(&pool)
            .await
            .unwrap();
    let updated = service
        .update_profile(&session, "  Product Owner  ".to_owned())
        .await
        .unwrap();
    assert_eq!(updated.display_name, "Product Owner");
    assert_eq!(updated.email, outcome.user.email);
    let updated_at: OffsetDateTime =
        sqlx::query_scalar("SELECT updated_at FROM users WHERE id = $1")
            .bind(outcome.user.id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!(updated_at > initial_updated_at);
    let profile_audit_count: i64 = sqlx::query_scalar(
        r#"
        SELECT count(*)
        FROM audit_logs
        WHERE actor_id = $1
          AND target_id = $1
          AND action = 'user.profile_updated'
          AND metadata = '{"changedFields":["displayName"]}'::jsonb
        "#,
    )
    .bind(outcome.user.id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(profile_audit_count, 1);

    let unchanged = service
        .update_profile(&session, "Product Owner".to_owned())
        .await
        .unwrap();
    assert_eq!(unchanged, updated);
    let unchanged_updated_at: OffsetDateTime =
        sqlx::query_scalar("SELECT updated_at FROM users WHERE id = $1")
            .bind(outcome.user.id)
            .fetch_one(&pool)
            .await
            .unwrap();
    let unchanged_audit_count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM audit_logs WHERE actor_id = $1 AND action = 'user.profile_updated'",
    )
    .bind(outcome.user.id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(unchanged_updated_at, updated_at);
    assert_eq!(unchanged_audit_count, 1);
    assert_eq!(
        service.authenticate(token).await.unwrap().profile(),
        updated
    );
    service.logout(token).await.unwrap();
    assert!(matches!(
        service.authenticate(token).await,
        Err(AuthError::Unauthenticated),
    ));
}

fn register_command(email: &str) -> RegisterCommand {
    RegisterCommand {
        email: email.to_owned(),
        display_name: "Owner".to_owned(),
        password: SecretString::from("correct horse battery staple".to_owned()),
    }
}
