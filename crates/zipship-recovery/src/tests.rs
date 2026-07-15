use super::*;
use std::sync::Mutex;

const NOW: OffsetDateTime = OffsetDateTime::UNIX_EPOCH;

#[derive(Default)]
struct RepositoryState {
    created: Vec<NewPasswordReset>,
    consumed: Vec<ConsumePasswordReset>,
}

#[derive(Default)]
struct TestRepository {
    state: Mutex<RepositoryState>,
}

#[async_trait]
impl PasswordRecoveryRepository for TestRepository {
    async fn create_password_reset(
        &self,
        reset: NewPasswordReset,
    ) -> Result<PasswordResetRequestDisposition, PasswordRecoveryRepositoryError> {
        self.state.lock().unwrap().created.push(reset);
        Ok(PasswordResetRequestDisposition::Created)
    }

    async fn consume_password_reset(
        &self,
        reset: ConsumePasswordReset,
    ) -> Result<(), PasswordRecoveryRepositoryError> {
        self.state.lock().unwrap().consumed.push(reset);
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

fn service(repository: Arc<TestRepository>) -> PasswordRecoveryService {
    PasswordRecoveryService::with_policy(
        repository,
        key_ring(),
        Arc::new(FixedClock),
        PasswordRecoveryPolicy::default(),
    )
}

#[test]
fn seals_with_aad_and_rejects_tampering() {
    let ring = key_ring();
    let request_id = Uuid::new_v4();
    let email = NormalizedEmail::parse("Ada@Example.COM").unwrap();
    let opaque_token = OpaqueToken::generate().unwrap();
    let token = opaque_token.secret();
    let envelope = ring.seal_password_reset(request_id, &email, token).unwrap();

    let opened = ring.open_password_reset(request_id, &envelope).unwrap();
    assert_eq!(opened.recipient.as_str(), "ada@example.com");
    assert_eq!(opened.token.expose_secret(), token.expose_secret());
    assert!(
        !envelope
            .ciphertext
            .windows(token.expose_secret().len())
            .any(|window| { window == token.expose_secret().as_bytes() })
    );
    assert!(ring.open_password_reset(Uuid::new_v4(), &envelope).is_err());

    let mut tampered = envelope;
    tampered.ciphertext[0] ^= 1;
    assert!(ring.open_password_reset(request_id, &tampered).is_err());
}

#[test]
fn decrypts_old_envelopes_during_key_rotation() {
    let old_ring = EnvelopeKeyRing::new(
        "previous",
        vec![("previous".to_owned(), SecretBox::new(Box::new([3_u8; 32])))],
    )
    .unwrap();
    let rotated_ring = EnvelopeKeyRing::new(
        "primary",
        vec![
            ("primary".to_owned(), SecretBox::new(Box::new([7_u8; 32]))),
            ("previous".to_owned(), SecretBox::new(Box::new([3_u8; 32]))),
        ],
    )
    .unwrap();
    let request_id = Uuid::new_v4();
    let email = NormalizedEmail::parse("ada@example.com").unwrap();
    let token = OpaqueToken::generate().unwrap();
    let old_envelope = old_ring
        .seal_password_reset(request_id, &email, token.secret())
        .unwrap();

    assert_eq!(old_envelope.key_id, "previous");
    assert_eq!(
        rotated_ring
            .open_password_reset(request_id, &old_envelope)
            .unwrap()
            .token
            .expose_secret(),
        token.secret().expose_secret()
    );
    assert_eq!(
        rotated_ring
            .seal_password_reset(Uuid::new_v4(), &email, token.secret())
            .unwrap()
            .key_id,
        "primary"
    );
}

#[test]
fn validates_key_ring_configuration() {
    assert_eq!(
        EnvelopeKeyRing::new("missing", Vec::new()).unwrap_err(),
        EnvelopeError::ActiveKeyMissing
    );
    assert_eq!(
        EnvelopeKeyRing::new(
            "invalid key",
            vec![(
                "invalid key".to_owned(),
                SecretBox::new(Box::new([1_u8; 32]))
            )]
        )
        .unwrap_err(),
        EnvelopeError::InvalidKeyId
    );
}

#[test]
fn parses_base64_key_rotation_configuration() {
    let configured = EnvelopeKeyRing::from_base64_config(
        "primary",
        &SecretString::from(format!(
            "primary:{},previous:{}",
            URL_SAFE_NO_PAD.encode([7_u8; 32]),
            URL_SAFE_NO_PAD.encode([3_u8; 32])
        )),
    )
    .unwrap();
    assert_eq!(configured.active_key_id.as_ref(), "primary");
    assert_eq!(configured.keys.len(), 2);
    assert!(
        EnvelopeKeyRing::from_base64_config(
            "primary",
            &SecretString::from("primary:dG9vLXNob3J0".to_owned())
        )
        .is_err()
    );
}

#[tokio::test]
async fn creates_normalized_bounded_reset_and_encrypted_outbox() {
    let repository = Arc::new(TestRepository::default());
    let service = service(repository.clone());
    service
        .request(RequestPasswordResetCommand {
            email: "  ADA@Example.COM ".to_owned(),
        })
        .await
        .unwrap();

    let state = repository.state.lock().unwrap();
    let created = &state.created[0];
    assert_eq!(created.email.as_str(), "ada@example.com");
    assert_eq!(created.requested_at, NOW);
    assert_eq!(created.expires_at, NOW + Duration::minutes(30));
    assert_eq!(created.cooldown_since, NOW - Duration::minutes(1));
    assert_eq!(created.window_since, NOW - Duration::hours(1));
    assert_eq!(created.max_requests_in_window, 5);
    assert_eq!(created.outbox_max_attempts, 8);
    let delivery = key_ring()
        .open_password_reset(created.id, &created.envelope)
        .unwrap();
    assert_eq!(delivery.recipient.as_str(), "ada@example.com");
    assert_eq!(
        digest_valid_opaque_token(delivery.token.expose_secret()),
        Some(created.token_digest)
    );
}

#[tokio::test]
async fn suppresses_invalid_emails_without_repository_access() {
    let repository = Arc::new(TestRepository::default());
    service(repository.clone())
        .request(RequestPasswordResetCommand {
            email: "not-an-email".to_owned(),
        })
        .await
        .unwrap();
    assert!(repository.state.lock().unwrap().created.is_empty());
}

#[tokio::test]
async fn validates_and_hashes_confirmation_inputs_before_consumption() {
    let repository = Arc::new(TestRepository::default());
    let service = service(repository.clone());
    let token = OpaqueToken::generate().unwrap();

    assert_eq!(
        service
            .confirm(ConfirmPasswordResetCommand {
                token: token.secret().expose_secret().to_owned(),
                password: SecretString::from("short".to_owned()),
            })
            .await,
        Err(PasswordRecoveryError::InvalidPassword)
    );
    assert_eq!(
        service
            .confirm(ConfirmPasswordResetCommand {
                token: "malformed".to_owned(),
                password: SecretString::from("new secure password".to_owned()),
            })
            .await,
        Err(PasswordRecoveryError::InvalidToken)
    );
    assert!(repository.state.lock().unwrap().consumed.is_empty());

    service
        .confirm(ConfirmPasswordResetCommand {
            token: token.secret().expose_secret().to_owned(),
            password: SecretString::from("new secure password".to_owned()),
        })
        .await
        .unwrap();
    let state = repository.state.lock().unwrap();
    let consumed = &state.consumed[0];
    assert_eq!(consumed.token_digest, token.digest());
    assert_eq!(consumed.consumed_at, NOW);
    assert!(
        PasswordEngine::default()
            .verify(
                &SecretString::from("new secure password".to_owned()),
                &consumed.password_hash
            )
            .unwrap()
    );
}
