use secrecy::{ExposeSecret, SecretBox, SecretString};
use sqlx::{PgPool, postgres::PgPoolOptions};
use std::sync::{Arc, Mutex};
use time::{Duration, OffsetDateTime};
use uuid::Uuid;
use zipship_auth::{AuthError, AuthService, LoginCommand, RegisterCommand};
use zipship_postgres::{PgAuthRepository, PgPasswordRecoveryRepository};
use zipship_recovery::{
    Clock, ConfirmPasswordResetCommand, EnvelopeKeyRing, PasswordRecoveryError,
    PasswordRecoveryPolicy, PasswordRecoveryService, RequestPasswordResetCommand, SealedEnvelope,
};

#[tokio::test]
#[ignore = "requires an isolated PostgreSQL database"]
async fn enforces_password_recovery_security_and_concurrency() {
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
    let owner_id = owner.user.id;
    let owner_organization_id: Uuid =
        sqlx::query_scalar("SELECT organization_id FROM memberships WHERE user_id = $1")
            .bind(owner_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    let clock = Arc::new(MutableClock::new(OffsetDateTime::now_utc()));
    let key_ring = key_ring();
    let recovery = PasswordRecoveryService::with_policy(
        Arc::new(PgPasswordRecoveryRepository::new(pool.clone())),
        key_ring.clone(),
        clock.clone(),
        PasswordRecoveryPolicy::default(),
    );

    request(&recovery, "not-an-email").await;
    request(&recovery, "missing@example.com").await;
    assert_eq!(reset_count(&pool).await, 0);

    request(&recovery, " Owner@Example.COM ").await;
    assert_eq!(reset_count(&pool).await, 1);
    let first = pending_delivery(&pool, &key_ring, owner_id).await;
    let stored_hash: Vec<u8> =
        sqlx::query_scalar("SELECT token_hash FROM password_reset_requests WHERE id = $1")
            .bind(first.request_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(stored_hash.len(), 32);
    assert_ne!(stored_hash, first.token.as_bytes());
    let raw_ciphertext: Vec<u8> =
        sqlx::query_scalar("SELECT ciphertext FROM email_outbox WHERE aggregate_id = $1")
            .bind(first.request_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!(
        !raw_ciphertext
            .windows(first.token.len())
            .any(|window| window == first.token.as_bytes())
    );

    clock.advance(Duration::seconds(30));
    request(&recovery, "owner@example.com").await;
    assert_eq!(reset_count(&pool).await, 1);

    for _ in 0..4 {
        clock.advance(Duration::minutes(1));
        request(&recovery, "owner@example.com").await;
    }
    assert_eq!(reset_count(&pool).await, 5);
    assert_eq!(state_count(&pool, owner_id, "pending").await, 1);
    assert_eq!(state_count(&pool, owner_id, "superseded").await, 4);
    assert_eq!(cleared_outbox_count(&pool, owner_id).await, 4);
    let latest = pending_delivery(&pool, &key_ring, owner_id).await;

    clock.advance(Duration::minutes(1));
    request(&recovery, "owner@example.com").await;
    assert_eq!(reset_count(&pool).await, 5);
    assert_eq!(
        pending_delivery(&pool, &key_ring, owner_id).await.token,
        latest.token
    );

    let second_session = auth
        .login(LoginCommand {
            email: "owner@example.com".to_owned(),
            password: SecretString::from("correct horse battery staple".to_owned()),
        })
        .await
        .unwrap();
    assert_ne!(second_session.session_id, owner.session_id);
    sqlx::query(
        r#"
        INSERT INTO api_tokens (id, user_id, name, token_hash, scopes, created_at)
        VALUES ($1, $2, 'recovery-test', $3, '{}', $4)
        "#,
    )
    .bind(Uuid::new_v4())
    .bind(owner_id)
    .bind([9_u8; 32].as_slice())
    .bind(clock.now())
    .execute(&pool)
    .await
    .unwrap();

    let first_confirmation = recovery.confirm(confirm_command(&latest.token));
    let second_confirmation = recovery.confirm(confirm_command(&latest.token));
    let (first_result, second_result) = tokio::join!(first_confirmation, second_confirmation);
    assert!(matches!(
        (&first_result, &second_result),
        (Ok(()), Err(PasswordRecoveryError::InvalidToken))
            | (Err(PasswordRecoveryError::InvalidToken), Ok(()))
    ));
    assert_eq!(state_count(&pool, owner_id, "pending").await, 0);
    assert_eq!(state_count(&pool, owner_id, "consumed").await, 1);
    assert_eq!(cleared_outbox_count(&pool, owner_id).await, 5);
    assert_eq!(active_session_count(&pool, owner_id).await, 0);
    assert_eq!(active_api_token_count(&pool, owner_id).await, 0);
    assert_eq!(
        audit_count(
            &pool,
            owner_organization_id,
            owner_id,
            "user.password_reset_completed"
        )
        .await,
        1
    );
    assert_eq!(
        recovery.confirm(confirm_command(&latest.token)).await,
        Err(PasswordRecoveryError::InvalidToken)
    );
    assert_eq!(
        auth.login(LoginCommand {
            email: "owner@example.com".to_owned(),
            password: SecretString::from("correct horse battery staple".to_owned()),
        })
        .await
        .unwrap_err(),
        AuthError::InvalidCredentials
    );
    auth.login(LoginCommand {
        email: "owner@example.com".to_owned(),
        password: SecretString::from("new correct horse battery staple".to_owned()),
    })
    .await
    .unwrap();

    let racer = register(&auth, "racer@example.com", "Racer").await;
    let request_a = recovery.request(request_command("racer@example.com"));
    let request_b = recovery.request(request_command("RACER@example.com"));
    let (request_a, request_b) = tokio::join!(request_a, request_b);
    request_a.unwrap();
    request_b.unwrap();
    assert_eq!(user_reset_count(&pool, racer.user.id).await, 1);
    let expiring = pending_delivery(&pool, &key_ring, racer.user.id).await;
    clock.advance(Duration::minutes(31));
    assert_eq!(
        recovery.confirm(confirm_command(&expiring.token)).await,
        Err(PasswordRecoveryError::InvalidToken)
    );
    assert_eq!(state_count(&pool, racer.user.id, "expired").await, 1);
    assert_eq!(cleared_outbox_count(&pool, racer.user.id).await, 1);

    let disabled = register(&auth, "disabled@example.com", "Disabled").await;
    request(&recovery, "disabled@example.com").await;
    assert_eq!(user_reset_count(&pool, disabled.user.id).await, 1);
    let disabled_token = pending_delivery(&pool, &key_ring, disabled.user.id).await;
    sqlx::query("UPDATE users SET disabled_at = $2 WHERE id = $1")
        .bind(disabled.user.id)
        .bind(clock.now())
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(
        recovery
            .confirm(confirm_command(&disabled_token.token))
            .await,
        Err(PasswordRecoveryError::InvalidToken)
    );
    request(&recovery, "disabled@example.com").await;
    assert_eq!(user_reset_count(&pool, disabled.user.id).await, 1);
    assert_eq!(state_count(&pool, disabled.user.id, "superseded").await, 1);
    assert_eq!(cleared_outbox_count(&pool, disabled.user.id).await, 1);

    let invalid_digest = sqlx::query(
        r#"
        INSERT INTO password_reset_requests (
            id, user_id, token_hash, state, requested_at, expires_at
        )
        VALUES ($1, $2, $3, 'pending', $4, $5)
        "#,
    )
    .bind(Uuid::new_v4())
    .bind(owner_id)
    .bind([1_u8; 31].as_slice())
    .bind(clock.now())
    .bind(clock.now() + Duration::minutes(30))
    .execute(&pool)
    .await;
    assert!(invalid_digest.is_err());
}

#[derive(Debug)]
struct PendingDelivery {
    request_id: Uuid,
    token: String,
}

#[derive(sqlx::FromRow)]
struct PendingOutboxRow {
    aggregate_id: Uuid,
    key_id: String,
    nonce: Vec<u8>,
    ciphertext: Vec<u8>,
}

async fn pending_delivery(
    pool: &PgPool,
    key_ring: &EnvelopeKeyRing,
    user_id: Uuid,
) -> PendingDelivery {
    let row = sqlx::query_as::<_, PendingOutboxRow>(
        r#"
        SELECT
            email_outbox.aggregate_id,
            email_outbox.key_id,
            email_outbox.nonce,
            email_outbox.ciphertext
        FROM email_outbox
        INNER JOIN password_reset_requests
            ON password_reset_requests.id = email_outbox.aggregate_id
        WHERE password_reset_requests.user_id = $1
          AND password_reset_requests.state = 'pending'
          AND email_outbox.state = 'queued'
        "#,
    )
    .bind(user_id)
    .fetch_one(pool)
    .await
    .unwrap();
    let envelope = SealedEnvelope {
        key_id: row.key_id,
        nonce: row.nonce.try_into().unwrap(),
        ciphertext: row.ciphertext,
    };
    let delivery = key_ring
        .open_password_reset(row.aggregate_id, &envelope)
        .unwrap();
    PendingDelivery {
        request_id: row.aggregate_id,
        token: delivery.token.expose_secret().to_owned(),
    }
}

fn key_ring() -> EnvelopeKeyRing {
    EnvelopeKeyRing::new(
        "test-primary",
        vec![(
            "test-primary".to_owned(),
            SecretBox::new(Box::new([7_u8; 32])),
        )],
    )
    .unwrap()
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
        let mut now = self.now.lock().unwrap();
        *now += duration;
    }
}

impl Clock for MutableClock {
    fn now(&self) -> OffsetDateTime {
        *self.now.lock().unwrap()
    }
}

async fn register(
    auth: &AuthService,
    email: &str,
    display_name: &str,
) -> zipship_auth::AuthOutcome {
    auth.register(RegisterCommand {
        email: email.to_owned(),
        display_name: display_name.to_owned(),
        password: SecretString::from("correct horse battery staple".to_owned()),
    })
    .await
    .unwrap()
}

fn request_command(email: &str) -> RequestPasswordResetCommand {
    RequestPasswordResetCommand {
        email: email.to_owned(),
    }
}

async fn request(recovery: &PasswordRecoveryService, email: &str) {
    recovery.request(request_command(email)).await.unwrap();
}

fn confirm_command(token: &str) -> ConfirmPasswordResetCommand {
    ConfirmPasswordResetCommand {
        token: token.to_owned(),
        password: SecretString::from("new correct horse battery staple".to_owned()),
    }
}

async fn reset_count(pool: &PgPool) -> i64 {
    sqlx::query_scalar("SELECT count(*) FROM password_reset_requests")
        .fetch_one(pool)
        .await
        .unwrap()
}

async fn user_reset_count(pool: &PgPool, user_id: Uuid) -> i64 {
    sqlx::query_scalar("SELECT count(*) FROM password_reset_requests WHERE user_id = $1")
        .bind(user_id)
        .fetch_one(pool)
        .await
        .unwrap()
}

async fn state_count(pool: &PgPool, user_id: Uuid, state: &str) -> i64 {
    sqlx::query_scalar(
        "SELECT count(*) FROM password_reset_requests WHERE user_id = $1 AND state = $2",
    )
    .bind(user_id)
    .bind(state)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn cleared_outbox_count(pool: &PgPool, user_id: Uuid) -> i64 {
    sqlx::query_scalar(
        r#"
        SELECT count(*)
        FROM email_outbox
        INNER JOIN password_reset_requests
            ON password_reset_requests.id = email_outbox.aggregate_id
        WHERE password_reset_requests.user_id = $1
          AND email_outbox.state = 'cancelled'
          AND email_outbox.key_id IS NULL
          AND email_outbox.nonce IS NULL
          AND email_outbox.ciphertext IS NULL
        "#,
    )
    .bind(user_id)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn active_session_count(pool: &PgPool, user_id: Uuid) -> i64 {
    sqlx::query_scalar(
        "SELECT count(*) FROM web_sessions WHERE user_id = $1 AND revoked_at IS NULL",
    )
    .bind(user_id)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn active_api_token_count(pool: &PgPool, user_id: Uuid) -> i64 {
    sqlx::query_scalar("SELECT count(*) FROM api_tokens WHERE user_id = $1 AND revoked_at IS NULL")
        .bind(user_id)
        .fetch_one(pool)
        .await
        .unwrap()
}

async fn audit_count(pool: &PgPool, organization_id: Uuid, user_id: Uuid, action: &str) -> i64 {
    sqlx::query_scalar(
        r#"
        SELECT count(*)
        FROM audit_logs
        WHERE organization_id = $1
          AND actor_id = $2
          AND target_id = $2
          AND action = $3
          AND metadata = '{}'::jsonb
        "#,
    )
    .bind(organization_id)
    .bind(user_id)
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
