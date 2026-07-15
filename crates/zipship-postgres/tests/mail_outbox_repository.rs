use secrecy::{SecretBox, SecretString};
use sqlx::{PgPool, postgres::PgPoolOptions};
use std::sync::{Arc, Mutex};
use time::{Duration, OffsetDateTime};
use uuid::Uuid;
use zipship_auth::{AuthService, RegisterCommand};
use zipship_jobs::{JobLease, WorkerId};
use zipship_mail::MailOutboxRepository;
use zipship_postgres::{PgAuthRepository, PgMailOutboxRepository, PgPasswordRecoveryRepository};
use zipship_recovery::{
    Clock, EnvelopeKeyRing, PasswordRecoveryPolicy, PasswordRecoveryService,
    RequestPasswordResetCommand,
};

#[tokio::test]
#[ignore = "requires an isolated PostgreSQL database"]
async fn leases_retries_delivers_and_sweeps_encrypted_mail() {
    let pool = test_pool().await;
    zipship_postgres::migrate(&pool).await.unwrap();
    sqlx::query("TRUNCATE TABLE organizations, users CASCADE")
        .execute(&pool)
        .await
        .unwrap();
    let auth = AuthService::new(Arc::new(PgAuthRepository::new(pool.clone())))
        .await
        .unwrap();
    let deliverable = register(&auth, "deliver@example.com").await;
    let exhausted = register(&auth, "exhausted@example.com").await;
    let expiring = register(&auth, "expiring@example.com").await;
    let clock = Arc::new(MutableClock::new(OffsetDateTime::now_utc()));
    let key_ring = key_ring();
    let recovery_repository = Arc::new(PgPasswordRecoveryRepository::new(pool.clone()));
    let recovery = PasswordRecoveryService::with_policy(
        recovery_repository.clone(),
        key_ring.clone(),
        clock.clone(),
        PasswordRecoveryPolicy::default(),
    );
    let outbox = PgMailOutboxRepository::new(pool.clone());
    let worker = WorkerId::parse("mail:integration").unwrap();
    let lease = JobLease::parse(std::time::Duration::from_secs(60)).unwrap();

    request(&recovery, "deliver@example.com").await;
    let first = outbox
        .claim_next(&worker, lease, clock.now())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(first.attempt, 1);
    assert_eq!(first.max_attempts, 8);
    assert_eq!(
        key_ring
            .open_password_reset(first.request_id, &first.envelope)
            .unwrap()
            .recipient
            .as_str(),
        "deliver@example.com"
    );
    assert!(
        outbox
            .heartbeat(first.outbox_id, &worker, lease, clock.now())
            .await
            .unwrap()
    );
    assert!(
        outbox
            .mark_failed(
                first.outbox_id,
                &worker,
                "SMTP_TEMPORARY",
                Some(clock.now() + Duration::seconds(1)),
                clock.now(),
            )
            .await
            .unwrap()
    );
    assert!(
        outbox
            .claim_next(&worker, lease, clock.now())
            .await
            .unwrap()
            .is_none()
    );
    clock.advance(Duration::seconds(1));
    let second = outbox
        .claim_next(&worker, lease, clock.now())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(second.outbox_id, first.outbox_id);
    assert_eq!(second.attempt, 2);
    assert!(
        outbox
            .mark_delivered(second.outbox_id, &worker, clock.now())
            .await
            .unwrap()
    );
    assert_eq!(outbox_state(&pool, deliverable.user.id).await, "delivered");
    assert!(
        outbox_ciphertext(&pool, deliverable.user.id)
            .await
            .is_none()
    );

    let one_attempt_recovery = PasswordRecoveryService::with_policy(
        recovery_repository,
        key_ring,
        clock.clone(),
        PasswordRecoveryPolicy {
            outbox_max_attempts: 1,
            ..PasswordRecoveryPolicy::default()
        },
    );
    request(&one_attempt_recovery, "exhausted@example.com").await;
    let exhausted_claim = outbox
        .claim_next(&worker, lease, clock.now())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(exhausted_claim.attempt, 1);
    clock.advance(Duration::seconds(61));
    assert_eq!(outbox.sweep(clock.now()).await.unwrap(), 1);
    assert_eq!(outbox_state(&pool, exhausted.user.id).await, "failed");
    assert!(outbox_ciphertext(&pool, exhausted.user.id).await.is_none());

    request(&recovery, "expiring@example.com").await;
    clock.advance(Duration::minutes(31));
    assert_eq!(outbox.sweep(clock.now()).await.unwrap(), 1);
    assert_eq!(reset_state(&pool, expiring.user.id).await, "expired");
    assert_eq!(outbox_state(&pool, expiring.user.id).await, "cancelled");
    assert!(outbox_ciphertext(&pool, expiring.user.id).await.is_none());
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
        *self.now.lock().unwrap() += duration;
    }
}

impl Clock for MutableClock {
    fn now(&self) -> OffsetDateTime {
        *self.now.lock().unwrap()
    }
}

async fn register(auth: &AuthService, email: &str) -> zipship_auth::AuthOutcome {
    auth.register(RegisterCommand {
        email: email.to_owned(),
        display_name: "Mail Test".to_owned(),
        password: SecretString::from("correct horse battery staple".to_owned()),
    })
    .await
    .unwrap()
}

async fn request(recovery: &PasswordRecoveryService, email: &str) {
    recovery
        .request(RequestPasswordResetCommand {
            email: email.to_owned(),
        })
        .await
        .unwrap();
}

async fn outbox_state(pool: &PgPool, user_id: Uuid) -> String {
    sqlx::query_scalar(
        r#"
        SELECT email_outbox.state
        FROM email_outbox
        INNER JOIN password_reset_requests
            ON password_reset_requests.id = email_outbox.aggregate_id
        WHERE password_reset_requests.user_id = $1
        ORDER BY email_outbox.created_at DESC
        LIMIT 1
        "#,
    )
    .bind(user_id)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn outbox_ciphertext(pool: &PgPool, user_id: Uuid) -> Option<Vec<u8>> {
    sqlx::query_scalar(
        r#"
        SELECT email_outbox.ciphertext
        FROM email_outbox
        INNER JOIN password_reset_requests
            ON password_reset_requests.id = email_outbox.aggregate_id
        WHERE password_reset_requests.user_id = $1
        ORDER BY email_outbox.created_at DESC
        LIMIT 1
        "#,
    )
    .bind(user_id)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn reset_state(pool: &PgPool, user_id: Uuid) -> String {
    sqlx::query_scalar(
        r#"
        SELECT state
        FROM password_reset_requests
        WHERE user_id = $1
        ORDER BY requested_at DESC
        LIMIT 1
        "#,
    )
    .bind(user_id)
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
