#![forbid(unsafe_code)]

use async_trait::async_trait;
use chacha20poly1305::{
    XChaCha20Poly1305, XNonce,
    aead::{Aead, KeyInit, Payload},
};
use secrecy::{ExposeSecret, SecretBox, SecretString};
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, error::Error as StdError, fmt, sync::Arc};
use thiserror::Error;
use time::{Duration, OffsetDateTime};
use tokio::task;
use uuid::Uuid;
use zeroize::Zeroize;
use zipship_auth::{
    EncodedPasswordHash, NormalizedEmail, OpaqueToken, PasswordEngine, TokenDigest,
    digest_valid_opaque_token, validate_password,
};

const DEFAULT_RESET_TTL: Duration = Duration::minutes(30);
const DEFAULT_REQUEST_COOLDOWN: Duration = Duration::minutes(1);
const DEFAULT_REQUEST_WINDOW: Duration = Duration::hours(1);
const DEFAULT_MAX_REQUESTS_PER_WINDOW: u16 = 5;
const DEFAULT_OUTBOX_MAX_ATTEMPTS: u16 = 8;
const DUMMY_EMAIL: &str = "password-recovery-dummy@invalid.example";
const ENVELOPE_PURPOSE: &[u8] = b"zipship:password-reset:v1:";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PasswordResetState {
    Pending,
    Consumed,
    Superseded,
    Expired,
}

impl PasswordResetState {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Consumed => "consumed",
            Self::Superseded => "superseded",
            Self::Expired => "expired",
        }
    }
}

#[derive(Clone, PartialEq, Eq)]
pub struct SealedEnvelope {
    pub key_id: String,
    pub nonce: [u8; 24],
    pub ciphertext: Vec<u8>,
}

impl fmt::Debug for SealedEnvelope {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("SealedEnvelope")
            .field("key_id", &self.key_id)
            .field("nonce", &"[redacted]")
            .field("ciphertext", &"[redacted]")
            .finish()
    }
}

#[derive(Debug)]
pub struct PasswordResetDelivery {
    pub recipient: NormalizedEmail,
    pub token: SecretString,
}

#[derive(Debug, Error, Clone, Copy, PartialEq, Eq)]
pub enum EnvelopeError {
    #[error("envelope key id is invalid")]
    InvalidKeyId,
    #[error("envelope key id is duplicated")]
    DuplicateKeyId,
    #[error("active envelope key is missing")]
    ActiveKeyMissing,
    #[error("envelope encryption failed")]
    EncryptionFailed,
    #[error("envelope cannot be decrypted")]
    DecryptionFailed,
}

#[derive(Clone)]
pub struct EnvelopeKeyRing {
    active_key_id: Arc<str>,
    keys: Arc<BTreeMap<String, Arc<SecretBox<[u8; 32]>>>>,
}

impl fmt::Debug for EnvelopeKeyRing {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("EnvelopeKeyRing")
            .field("active_key_id", &self.active_key_id)
            .field("key_count", &self.keys.len())
            .finish_non_exhaustive()
    }
}

impl EnvelopeKeyRing {
    pub fn new(
        active_key_id: impl Into<String>,
        keys: Vec<(String, SecretBox<[u8; 32]>)>,
    ) -> Result<Self, EnvelopeError> {
        let active_key_id = active_key_id.into();
        validate_key_id(&active_key_id)?;
        let mut indexed = BTreeMap::new();
        for (key_id, key) in keys {
            validate_key_id(&key_id)?;
            if indexed.insert(key_id, Arc::new(key)).is_some() {
                return Err(EnvelopeError::DuplicateKeyId);
            }
        }
        if !indexed.contains_key(&active_key_id) {
            return Err(EnvelopeError::ActiveKeyMissing);
        }
        Ok(Self {
            active_key_id: Arc::from(active_key_id),
            keys: Arc::new(indexed),
        })
    }

    pub fn seal_password_reset(
        &self,
        request_id: Uuid,
        recipient: &NormalizedEmail,
        token: &SecretString,
    ) -> Result<SealedEnvelope, EnvelopeError> {
        if digest_valid_opaque_token(token.expose_secret()).is_none() {
            return Err(EnvelopeError::EncryptionFailed);
        }
        let key = self
            .keys
            .get(self.active_key_id.as_ref())
            .ok_or(EnvelopeError::ActiveKeyMissing)?;
        let payload = DeliveryPayloadRef {
            recipient: recipient.as_str(),
            token: token.expose_secret(),
        };
        let mut plaintext =
            serde_json::to_vec(&payload).map_err(|_| EnvelopeError::EncryptionFailed)?;
        let mut nonce = [0_u8; 24];
        if getrandom::fill(&mut nonce).is_err() {
            plaintext.zeroize();
            return Err(EnvelopeError::EncryptionFailed);
        }
        let cipher = XChaCha20Poly1305::new_from_slice(key.expose_secret())
            .map_err(|_| EnvelopeError::EncryptionFailed)?;
        let aad = envelope_aad(request_id);
        let nonce_value = XNonce::from(nonce);
        let encrypted = cipher.encrypt(
            &nonce_value,
            Payload {
                msg: &plaintext,
                aad: &aad,
            },
        );
        plaintext.zeroize();
        Ok(SealedEnvelope {
            key_id: self.active_key_id.to_string(),
            nonce,
            ciphertext: encrypted.map_err(|_| EnvelopeError::EncryptionFailed)?,
        })
    }

    pub fn open_password_reset(
        &self,
        request_id: Uuid,
        envelope: &SealedEnvelope,
    ) -> Result<PasswordResetDelivery, EnvelopeError> {
        let key = self
            .keys
            .get(&envelope.key_id)
            .ok_or(EnvelopeError::DecryptionFailed)?;
        let cipher = XChaCha20Poly1305::new_from_slice(key.expose_secret())
            .map_err(|_| EnvelopeError::DecryptionFailed)?;
        let aad = envelope_aad(request_id);
        let nonce = XNonce::from(envelope.nonce);
        let mut plaintext = cipher
            .decrypt(
                &nonce,
                Payload {
                    msg: &envelope.ciphertext,
                    aad: &aad,
                },
            )
            .map_err(|_| EnvelopeError::DecryptionFailed)?;
        let payload = serde_json::from_slice::<DeliveryPayload>(&plaintext)
            .map_err(|_| EnvelopeError::DecryptionFailed);
        plaintext.zeroize();
        let payload = payload?;
        let recipient = NormalizedEmail::parse(&payload.recipient)
            .map_err(|_| EnvelopeError::DecryptionFailed)?;
        if digest_valid_opaque_token(&payload.token).is_none() {
            return Err(EnvelopeError::DecryptionFailed);
        }
        Ok(PasswordResetDelivery {
            recipient,
            token: SecretString::from(payload.token),
        })
    }
}

#[derive(Serialize)]
struct DeliveryPayloadRef<'a> {
    recipient: &'a str,
    token: &'a str,
}

#[derive(Deserialize)]
struct DeliveryPayload {
    recipient: String,
    token: String,
}

fn validate_key_id(key_id: &str) -> Result<(), EnvelopeError> {
    if key_id.is_empty()
        || key_id.len() > 64
        || !key_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
    {
        return Err(EnvelopeError::InvalidKeyId);
    }
    Ok(())
}

fn envelope_aad(request_id: Uuid) -> Vec<u8> {
    let mut aad = Vec::with_capacity(ENVELOPE_PURPOSE.len() + 16);
    aad.extend_from_slice(ENVELOPE_PURPOSE);
    aad.extend_from_slice(request_id.as_bytes());
    aad
}

#[derive(Debug, Clone)]
pub struct NewPasswordReset {
    pub id: Uuid,
    pub outbox_id: Uuid,
    pub email: NormalizedEmail,
    pub token_digest: TokenDigest,
    pub envelope: SealedEnvelope,
    pub requested_at: OffsetDateTime,
    pub expires_at: OffsetDateTime,
    pub cooldown_since: OffsetDateTime,
    pub window_since: OffsetDateTime,
    pub max_requests_in_window: u16,
    pub outbox_max_attempts: u16,
}

#[derive(Debug, Clone)]
pub struct ConsumePasswordReset {
    pub token_digest: TokenDigest,
    pub password_hash: EncodedPasswordHash,
    pub consumed_at: OffsetDateTime,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PasswordResetRequestDisposition {
    Created,
    Suppressed,
}

#[derive(Debug, Error)]
pub enum PasswordRecoveryRepositoryError {
    #[error("password reset token is invalid")]
    InvalidToken,
    #[error("password recovery repository is unavailable")]
    Unavailable {
        #[source]
        source: Box<dyn StdError + Send + Sync>,
    },
}

impl PasswordRecoveryRepositoryError {
    pub fn unavailable(source: impl StdError + Send + Sync + 'static) -> Self {
        Self::Unavailable {
            source: Box::new(source),
        }
    }
}

#[async_trait]
pub trait PasswordRecoveryRepository: Send + Sync + 'static {
    async fn create_password_reset(
        &self,
        reset: NewPasswordReset,
    ) -> Result<PasswordResetRequestDisposition, PasswordRecoveryRepositoryError>;

    async fn consume_password_reset(
        &self,
        reset: ConsumePasswordReset,
    ) -> Result<(), PasswordRecoveryRepositoryError>;
}

pub trait Clock: Send + Sync + 'static {
    fn now(&self) -> OffsetDateTime;
}

#[derive(Debug, Default)]
pub struct SystemClock;

impl Clock for SystemClock {
    fn now(&self) -> OffsetDateTime {
        OffsetDateTime::now_utc()
    }
}

#[derive(Debug, Error, Clone, Copy, PartialEq, Eq)]
pub enum PasswordRecoveryError {
    #[error("password does not satisfy the policy")]
    InvalidPassword,
    #[error("password reset token is invalid")]
    InvalidToken,
    #[error("password recovery infrastructure failed")]
    Infrastructure,
}

impl PasswordRecoveryError {
    pub const fn code(self) -> &'static str {
        match self {
            Self::InvalidPassword => "INVALID_PASSWORD",
            Self::InvalidToken => "INVALID_PASSWORD_RESET_TOKEN",
            Self::Infrastructure => "PASSWORD_RECOVERY_INFRASTRUCTURE_FAILURE",
        }
    }
}

#[derive(Debug)]
pub struct RequestPasswordResetCommand {
    pub email: String,
}

#[derive(Debug)]
pub struct ConfirmPasswordResetCommand {
    pub token: String,
    pub password: SecretString,
}

#[derive(Clone)]
pub struct PasswordRecoveryService {
    repository: Arc<dyn PasswordRecoveryRepository>,
    key_ring: EnvelopeKeyRing,
    clock: Arc<dyn Clock>,
    password_engine: PasswordEngine,
    reset_ttl: Duration,
    request_cooldown: Duration,
    request_window: Duration,
    max_requests_per_window: u16,
    outbox_max_attempts: u16,
}

impl PasswordRecoveryService {
    pub fn new(repository: Arc<dyn PasswordRecoveryRepository>, key_ring: EnvelopeKeyRing) -> Self {
        Self::with_policy(
            repository,
            key_ring,
            Arc::new(SystemClock),
            PasswordRecoveryPolicy::default(),
        )
    }

    pub fn with_policy(
        repository: Arc<dyn PasswordRecoveryRepository>,
        key_ring: EnvelopeKeyRing,
        clock: Arc<dyn Clock>,
        policy: PasswordRecoveryPolicy,
    ) -> Self {
        policy.validate();
        Self {
            repository,
            key_ring,
            clock,
            password_engine: PasswordEngine::default(),
            reset_ttl: policy.reset_ttl,
            request_cooldown: policy.request_cooldown,
            request_window: policy.request_window,
            max_requests_per_window: policy.max_requests_per_window,
            outbox_max_attempts: policy.outbox_max_attempts,
        }
    }

    pub async fn request(
        &self,
        command: RequestPasswordResetCommand,
    ) -> Result<(), PasswordRecoveryError> {
        let email = NormalizedEmail::parse(&command.email);
        let recipient =
            email.as_ref().ok().cloned().unwrap_or_else(|| {
                NormalizedEmail::parse(DUMMY_EMAIL).expect("dummy email is valid")
            });
        let token = OpaqueToken::generate().map_err(|_| PasswordRecoveryError::Infrastructure)?;
        let request_id = Uuid::new_v4();
        let envelope = self
            .key_ring
            .seal_password_reset(request_id, &recipient, token.secret())
            .map_err(|_| PasswordRecoveryError::Infrastructure)?;
        let Ok(email) = email else {
            return Ok(());
        };
        let requested_at = self.clock.now();
        let expires_at = requested_at
            .checked_add(self.reset_ttl)
            .ok_or(PasswordRecoveryError::Infrastructure)?;
        let cooldown_since = requested_at
            .checked_sub(self.request_cooldown)
            .ok_or(PasswordRecoveryError::Infrastructure)?;
        let window_since = requested_at
            .checked_sub(self.request_window)
            .ok_or(PasswordRecoveryError::Infrastructure)?;
        self.repository
            .create_password_reset(NewPasswordReset {
                id: request_id,
                outbox_id: Uuid::new_v4(),
                email,
                token_digest: token.digest(),
                envelope,
                requested_at,
                expires_at,
                cooldown_since,
                window_since,
                max_requests_in_window: self.max_requests_per_window,
                outbox_max_attempts: self.outbox_max_attempts,
            })
            .await
            .map(|_| ())
            .map_err(map_repository_error)
    }

    pub async fn confirm(
        &self,
        command: ConfirmPasswordResetCommand,
    ) -> Result<(), PasswordRecoveryError> {
        validate_password(command.password.expose_secret())
            .map_err(|_| PasswordRecoveryError::InvalidPassword)?;
        let token_digest =
            digest_valid_opaque_token(&command.token).ok_or(PasswordRecoveryError::InvalidToken)?;
        let engine = self.password_engine.clone();
        let password_hash = task::spawn_blocking(move || engine.hash(&command.password))
            .await
            .map_err(|_| PasswordRecoveryError::Infrastructure)?
            .map_err(|_| PasswordRecoveryError::Infrastructure)?;
        self.repository
            .consume_password_reset(ConsumePasswordReset {
                token_digest,
                password_hash,
                consumed_at: self.clock.now(),
            })
            .await
            .map_err(map_repository_error)
    }
}

#[derive(Debug, Clone, Copy)]
pub struct PasswordRecoveryPolicy {
    pub reset_ttl: Duration,
    pub request_cooldown: Duration,
    pub request_window: Duration,
    pub max_requests_per_window: u16,
    pub outbox_max_attempts: u16,
}

impl Default for PasswordRecoveryPolicy {
    fn default() -> Self {
        Self {
            reset_ttl: DEFAULT_RESET_TTL,
            request_cooldown: DEFAULT_REQUEST_COOLDOWN,
            request_window: DEFAULT_REQUEST_WINDOW,
            max_requests_per_window: DEFAULT_MAX_REQUESTS_PER_WINDOW,
            outbox_max_attempts: DEFAULT_OUTBOX_MAX_ATTEMPTS,
        }
    }
}

impl PasswordRecoveryPolicy {
    fn validate(self) {
        assert!(self.reset_ttl.is_positive(), "reset TTL must be positive");
        assert!(
            self.request_cooldown.is_positive(),
            "request cooldown must be positive"
        );
        assert!(
            self.request_window >= self.request_cooldown,
            "request window must contain the cooldown"
        );
        assert!(
            self.max_requests_per_window > 0,
            "request window limit must be positive"
        );
        assert!(
            self.outbox_max_attempts > 0 && self.outbox_max_attempts <= i16::MAX as u16,
            "outbox maximum attempts must fit PostgreSQL smallint"
        );
    }
}

fn map_repository_error(error: PasswordRecoveryRepositoryError) -> PasswordRecoveryError {
    match error {
        PasswordRecoveryRepositoryError::InvalidToken => PasswordRecoveryError::InvalidToken,
        PasswordRecoveryRepositoryError::Unavailable { .. } => {
            PasswordRecoveryError::Infrastructure
        }
    }
}

#[cfg(test)]
mod tests {
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
}
