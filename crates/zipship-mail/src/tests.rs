use super::*;
use crate::mailer::build_password_reset_message;
use async_trait::async_trait;
use secrecy::{ExposeSecret, SecretBox, SecretString};
use std::sync::{Arc, Mutex};
use time::{Duration, OffsetDateTime};
use url::Url;
use uuid::Uuid;
use zipship_auth::{NormalizedEmail, OpaqueToken};
use zipship_jobs::{JobLease, WorkerId};
use zipship_recovery::{Clock, EnvelopeKeyRing};

const NOW: OffsetDateTime = OffsetDateTime::UNIX_EPOCH;

#[derive(Default)]
struct RepositoryState {
    claimed: Option<ClaimedMail>,
    delivered: Vec<Uuid>,
    failed: Vec<(Uuid, &'static str, Option<OffsetDateTime>)>,
}

struct TestRepository {
    state: Mutex<RepositoryState>,
}

#[async_trait]
impl MailOutboxRepository for TestRepository {
    async fn claim_next(
        &self,
        _worker_id: &WorkerId,
        _lease: JobLease,
        _now: OffsetDateTime,
    ) -> Result<Option<ClaimedMail>, MailOutboxRepositoryError> {
        Ok(self.state.lock().unwrap().claimed.take())
    }

    async fn heartbeat(
        &self,
        _outbox_id: Uuid,
        _worker_id: &WorkerId,
        _lease: JobLease,
        _now: OffsetDateTime,
    ) -> Result<bool, MailOutboxRepositoryError> {
        Ok(true)
    }

    async fn mark_delivered(
        &self,
        outbox_id: Uuid,
        _worker_id: &WorkerId,
        _delivered_at: OffsetDateTime,
    ) -> Result<bool, MailOutboxRepositoryError> {
        self.state.lock().unwrap().delivered.push(outbox_id);
        Ok(true)
    }

    async fn mark_failed(
        &self,
        outbox_id: Uuid,
        _worker_id: &WorkerId,
        error_code: &'static str,
        retry_at: Option<OffsetDateTime>,
        _failed_at: OffsetDateTime,
    ) -> Result<bool, MailOutboxRepositoryError> {
        self.state
            .lock()
            .unwrap()
            .failed
            .push((outbox_id, error_code, retry_at));
        Ok(true)
    }

    async fn sweep(&self, _now: OffsetDateTime) -> Result<u64, MailOutboxRepositoryError> {
        Ok(0)
    }
}

struct RecordingMailer {
    sent: Mutex<Vec<PasswordResetMail>>,
    failure: Option<(&'static str, bool)>,
}

#[async_trait]
impl PasswordResetMailer for RecordingMailer {
    async fn send(&self, mail: &PasswordResetMail) -> Result<(), MailDeliveryError> {
        if let Some((code, retryable)) = self.failure {
            return Err(MailDeliveryError::new(code, retryable));
        }
        self.sent.lock().unwrap().push(PasswordResetMail {
            recipient: mail.recipient.clone(),
            reset_url: mail.reset_url.clone(),
        });
        Ok(())
    }
}

struct FixedClock;

impl Clock for FixedClock {
    fn now(&self) -> OffsetDateTime {
        NOW
    }
}

fn key_ring() -> EnvelopeKeyRing {
    EnvelopeKeyRing::new(
        "primary",
        vec![("primary".to_owned(), SecretBox::new(Box::new([7_u8; 32])))],
    )
    .unwrap()
}

fn claimed_mail(key_ring: &EnvelopeKeyRing) -> (ClaimedMail, String) {
    let request_id = Uuid::new_v4();
    let token = OpaqueToken::generate().unwrap();
    let envelope = key_ring
        .seal_password_reset(
            request_id,
            &NormalizedEmail::parse("ada@example.com").unwrap(),
            token.secret(),
        )
        .unwrap();
    (
        ClaimedMail {
            outbox_id: Uuid::new_v4(),
            request_id,
            envelope,
            attempt: 1,
            max_attempts: 5,
            expires_at: NOW + Duration::minutes(30),
        },
        token.secret().expose_secret().to_owned(),
    )
}

fn worker(
    repository: Arc<TestRepository>,
    mailer: Arc<RecordingMailer>,
    key_ring: EnvelopeKeyRing,
) -> PasswordResetMailWorker {
    PasswordResetMailWorker::with_clock(
        repository,
        mailer,
        key_ring,
        Url::parse("https://console.example.com/").unwrap(),
        WorkerId::parse("mail:test").unwrap(),
        JobLease::parse(std::time::Duration::from_secs(60)).unwrap(),
        Arc::new(FixedClock),
    )
}

#[tokio::test]
async fn decrypts_and_delivers_fragment_only_reset_links() {
    let key_ring = key_ring();
    let (claimed, token) = claimed_mail(&key_ring);
    let outbox_id = claimed.outbox_id;
    let repository = Arc::new(TestRepository {
        state: Mutex::new(RepositoryState {
            claimed: Some(claimed),
            ..RepositoryState::default()
        }),
    });
    let mailer = Arc::new(RecordingMailer {
        sent: Mutex::new(Vec::new()),
        failure: None,
    });

    assert_eq!(
        worker(repository.clone(), mailer.clone(), key_ring)
            .process_next()
            .await
            .unwrap(),
        MailWorkOutcome::Delivered { outbox_id }
    );
    let sent = mailer.sent.lock().unwrap();
    assert_eq!(sent[0].recipient, "ada@example.com");
    assert_eq!(
        sent[0].reset_url.expose_secret(),
        format!("https://console.example.com/reset-password#token={token}")
    );
    assert_eq!(repository.state.lock().unwrap().delivered, [outbox_id]);
}

#[tokio::test]
async fn retries_transient_failures_and_finishes_permanent_failures() {
    for (retryable, expected_retry) in [(true, true), (false, false)] {
        let key_ring = key_ring();
        let (claimed, _) = claimed_mail(&key_ring);
        let outbox_id = claimed.outbox_id;
        let repository = Arc::new(TestRepository {
            state: Mutex::new(RepositoryState {
                claimed: Some(claimed),
                ..RepositoryState::default()
            }),
        });
        let mailer = Arc::new(RecordingMailer {
            sent: Mutex::new(Vec::new()),
            failure: Some(("TEST_DELIVERY_FAILED", retryable)),
        });

        let outcome = worker(repository.clone(), mailer, key_ring)
            .process_next()
            .await
            .unwrap();
        assert_eq!(
            outcome,
            if expected_retry {
                MailWorkOutcome::RetryScheduled { outbox_id }
            } else {
                MailWorkOutcome::Failed { outbox_id }
            }
        );
        assert_eq!(
            repository.state.lock().unwrap().failed[0].2.is_some(),
            expected_retry
        );
    }
}

#[test]
fn builds_plain_text_mail_without_moving_token_into_headers() {
    let token = OpaqueToken::generate().unwrap();
    let mail = PasswordResetMail {
        recipient: "ada@example.com".to_owned(),
        reset_url: SecretString::from(format!(
            "https://console.example.com/reset-password#token={}",
            token.secret().expose_secret()
        )),
    };
    let message =
        build_password_reset_message(&"ZipShip <security@example.com>".parse().unwrap(), &mail)
            .unwrap();
    let rendered = String::from_utf8(message.formatted()).unwrap();
    let (headers, body) = rendered.split_once("\r\n\r\n").unwrap();
    assert!(!headers.contains(token.secret().expose_secret()));
    assert!(
        body.replace("=\r\n", "")
            .contains(token.secret().expose_secret())
    );
}
