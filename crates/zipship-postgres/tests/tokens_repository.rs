use secrecy::{ExposeSecret, SecretString};
use sqlx::{PgPool, postgres::PgPoolOptions};
use std::sync::{Arc, Mutex};
use time::{Duration, OffsetDateTime};
use uuid::Uuid;
use zipship_auth::{AuthService, RegisterCommand};
use zipship_postgres::{PgApiTokensRepository, PgAuthRepository};
use zipship_tokens::{
    ApiTokenState, ApiTokensError, ApiTokensService, Clock, CreateApiTokenCommand,
    RevokeApiTokenCommand,
};

#[tokio::test]
#[ignore = "requires an isolated PostgreSQL database"]
async fn enforces_api_token_security_limits_and_concurrency() {
    let pool = test_pool().await;
    zipship_postgres::migrate(&pool).await.unwrap();
    sqlx::query("TRUNCATE TABLE organizations, users CASCADE")
        .execute(&pool)
        .await
        .unwrap();

    let auth = AuthService::new(Arc::new(PgAuthRepository::new(pool.clone())))
        .await
        .unwrap();
    let owner = register(&auth, "owner@example.com", "Owner").await;
    let other = register(&auth, "other@example.com", "Other").await;
    let owner_organization_id: Uuid =
        sqlx::query_scalar("SELECT organization_id FROM memberships WHERE user_id = $1")
            .bind(owner)
            .fetch_one(&pool)
            .await
            .unwrap();
    let clock = Arc::new(MutableClock::new(
        OffsetDateTime::from_unix_timestamp(2_000_000_000).unwrap(),
    ));
    let repository = Arc::new(PgApiTokensRepository::new(pool.clone()));
    let tokens = ApiTokensService::with_clock(repository, clock.clone());

    let issued = create(&tokens, owner, "Primary", 90).await.unwrap();
    let token_id = issued.token.id;
    let secret = issued.secret.expose_secret().to_owned();
    let stored_hash: Vec<u8> =
        sqlx::query_scalar("SELECT token_hash FROM api_tokens WHERE id = $1")
            .bind(token_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(stored_hash.len(), 32);
    assert_ne!(stored_hash, secret.as_bytes());
    assert_eq!(
        audit_count(&pool, owner_organization_id, token_id, "api_token.created").await,
        1
    );

    let principal = tokens.authenticate(&secret).await.unwrap();
    assert_eq!(principal.token_id, token_id);
    assert_eq!(last_used_at(&pool, token_id).await, Some(clock.now()));
    let first_use = clock.now();
    clock.advance(Duration::minutes(1));
    tokens.authenticate(&secret).await.unwrap();
    assert_eq!(last_used_at(&pool, token_id).await, Some(first_use));
    clock.advance(Duration::minutes(5));
    tokens.authenticate(&secret).await.unwrap();
    assert_eq!(last_used_at(&pool, token_id).await, Some(clock.now()));
    let latest_use = clock.now();
    clock.set(first_use + Duration::minutes(2));

    let listed = tokens.list(owner).await.unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].id, token_id);
    assert_eq!(listed[0].state_at(clock.now()), ApiTokenState::Active);
    assert_eq!(
        tokens
            .revoke(RevokeApiTokenCommand {
                user_id: other,
                token_id,
            })
            .await,
        Err(ApiTokensError::NotFound)
    );

    let revoke_a = tokens.revoke(RevokeApiTokenCommand {
        user_id: owner,
        token_id,
    });
    let revoke_b = tokens.revoke(RevokeApiTokenCommand {
        user_id: owner,
        token_id,
    });
    let (revoke_a, revoke_b) = tokio::join!(revoke_a, revoke_b);
    let revoke_a = revoke_a.unwrap();
    let revoke_b = revoke_b.unwrap();
    assert_eq!(revoke_a.state_at(clock.now()), ApiTokenState::Revoked);
    assert_eq!(revoke_b.state_at(clock.now()), ApiTokenState::Revoked);
    assert_eq!(revoke_a.revoked_at, Some(latest_use));
    assert_eq!(revoke_b.revoked_at, Some(latest_use));
    assert_eq!(
        audit_count(&pool, owner_organization_id, token_id, "api_token.revoked").await,
        1
    );
    assert_eq!(
        tokens.authenticate(&secret).await,
        Err(ApiTokensError::Unauthenticated)
    );

    let raced = create(&tokens, owner, "Race", 90).await.unwrap();
    let raced_id = raced.token.id;
    let raced_secret = raced.secret.expose_secret().to_owned();
    let revoke = tokens.revoke(RevokeApiTokenCommand {
        user_id: owner,
        token_id: raced_id,
    });
    let authenticate = tokens.authenticate(&raced_secret);
    let (revoke, authenticate) = tokio::join!(revoke, authenticate);
    revoke.unwrap();
    assert!(matches!(
        authenticate,
        Ok(_) | Err(ApiTokensError::Unauthenticated)
    ));
    assert_eq!(
        tokens.authenticate(&raced_secret).await,
        Err(ApiTokensError::Unauthenticated)
    );

    for index in 0..19 {
        create(&tokens, other, &format!("limit-{index}"), 90)
            .await
            .unwrap();
    }
    let twentieth = create(&tokens, other, "limit-final-a", 90);
    let twenty_first = create(&tokens, other, "limit-final-b", 90);
    let (twentieth, twenty_first) = tokio::join!(twentieth, twenty_first);
    let results = [twentieth, twenty_first];
    assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
    assert_eq!(
        results
            .iter()
            .filter(|result| matches!(result, Err(ApiTokensError::LimitReached)))
            .count(),
        1
    );
    assert_eq!(active_count(&pool, other, clock.now()).await, 20);

    assert_schema_constraints(&pool, other, clock.now()).await;
    sqlx::query("UPDATE users SET disabled_at = $2 WHERE id = $1")
        .bind(owner)
        .bind(clock.now())
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(
        tokens.list(owner).await,
        Err(ApiTokensError::Unauthenticated)
    );
    assert!(matches!(
        create(&tokens, owner, "disabled", 90).await,
        Err(ApiTokensError::Unauthenticated)
    ));
}

async fn assert_schema_constraints(pool: &PgPool, user_id: Uuid, now: OffsetDateTime) {
    let invalid_digest = insert_raw_token(
        pool,
        user_id,
        [1_u8; 31].as_slice(),
        "zps_12345678",
        vec!["projects:read"],
        now,
        now + Duration::days(30),
    )
    .await;
    assert!(invalid_digest.is_err());

    let duplicate_scopes = insert_raw_token(
        pool,
        user_id,
        [2_u8; 32].as_slice(),
        "zps_22345678",
        vec!["projects:read", "projects:read"],
        now,
        now + Duration::days(30),
    )
    .await;
    assert!(duplicate_scopes.is_err());

    let unknown_scope = insert_raw_token(
        pool,
        user_id,
        [3_u8; 32].as_slice(),
        "zps_32345678",
        vec!["admin"],
        now,
        now + Duration::days(30),
    )
    .await;
    assert!(unknown_scope.is_err());

    let invalid_expiration = insert_raw_token(
        pool,
        user_id,
        [4_u8; 32].as_slice(),
        "zps_42345678",
        vec!["projects:read"],
        now,
        now + Duration::hours(23),
    )
    .await;
    assert!(invalid_expiration.is_err());
}

async fn insert_raw_token(
    pool: &PgPool,
    user_id: Uuid,
    token_hash: &[u8],
    display_prefix: &str,
    scopes: Vec<&str>,
    created_at: OffsetDateTime,
    expires_at: OffsetDateTime,
) -> Result<sqlx::postgres::PgQueryResult, sqlx::Error> {
    sqlx::query(
        r#"
        INSERT INTO api_tokens (
            id,
            user_id,
            name,
            display_prefix,
            token_hash,
            scopes,
            expires_at,
            created_at
        )
        VALUES ($1, $2, 'constraint-test', $3, $4, $5, $6, $7)
        "#,
    )
    .bind(Uuid::new_v4())
    .bind(user_id)
    .bind(display_prefix)
    .bind(token_hash)
    .bind(scopes)
    .bind(expires_at)
    .bind(created_at)
    .execute(pool)
    .await
}

#[derive(Debug)]
struct MutableClock {
    now: Mutex<OffsetDateTime>,
}

impl MutableClock {
    fn new(now: OffsetDateTime) -> Self {
        Self {
            now: Mutex::new(now),
        }
    }

    fn advance(&self, duration: Duration) {
        *self.now.lock().unwrap() += duration;
    }

    fn set(&self, now: OffsetDateTime) {
        *self.now.lock().unwrap() = now;
    }
}

impl Clock for MutableClock {
    fn now(&self) -> OffsetDateTime {
        *self.now.lock().unwrap()
    }
}

async fn register(auth: &AuthService, email: &str, display_name: &str) -> Uuid {
    auth.register(RegisterCommand {
        email: email.to_owned(),
        display_name: display_name.to_owned(),
        password: SecretString::from("correct horse battery staple".to_owned()),
    })
    .await
    .unwrap()
    .user
    .id
}

async fn create(
    tokens: &ApiTokensService,
    user_id: Uuid,
    name: &str,
    expires_in_days: u16,
) -> Result<zipship_tokens::IssuedApiToken, ApiTokensError> {
    tokens
        .create(CreateApiTokenCommand {
            user_id,
            name: name.to_owned(),
            scopes: vec!["projects:read".to_owned(), "uploads:write".to_owned()],
            expires_in_days,
        })
        .await
}

async fn last_used_at(pool: &PgPool, token_id: Uuid) -> Option<OffsetDateTime> {
    sqlx::query_scalar("SELECT last_used_at FROM api_tokens WHERE id = $1")
        .bind(token_id)
        .fetch_one(pool)
        .await
        .unwrap()
}

async fn active_count(pool: &PgPool, user_id: Uuid, now: OffsetDateTime) -> i64 {
    sqlx::query_scalar(
        "SELECT count(*) FROM api_tokens WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > $2",
    )
    .bind(user_id)
    .bind(now)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn audit_count(pool: &PgPool, organization_id: Uuid, token_id: Uuid, action: &str) -> i64 {
    sqlx::query_scalar(
        r#"
        SELECT count(*)
        FROM audit_logs
        WHERE organization_id = $1
          AND target_id = $2
          AND action = $3
          AND target_type = 'api_token'
          AND metadata = '{}'::jsonb
        "#,
    )
    .bind(organization_id)
    .bind(token_id)
    .bind(action)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn test_pool() -> PgPool {
    let database_url = std::env::var("ZIPSHIP_TEST_DATABASE_URL")
        .expect("ZIPSHIP_TEST_DATABASE_URL is required for the PostgreSQL integration test");
    PgPoolOptions::new()
        .max_connections(8)
        .connect(&database_url)
        .await
        .unwrap()
}
