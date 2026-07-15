use crate::{
    constants::DUMMY_EMAIL,
    envelope::EnvelopeKeyRing,
    model::{ConsumePasswordReset, NewPasswordReset},
    policy::PasswordRecoveryPolicy,
    repository::{Clock, PasswordRecoveryRepository, PasswordRecoveryRepositoryError, SystemClock},
};
use secrecy::{ExposeSecret, SecretString};
use std::sync::Arc;
use thiserror::Error;
use time::Duration;
use tokio::task;
use uuid::Uuid;
use zipship_auth::{
    NormalizedEmail, OpaqueToken, PasswordEngine, digest_valid_opaque_token, validate_password,
};

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

fn map_repository_error(error: PasswordRecoveryRepositoryError) -> PasswordRecoveryError {
    match error {
        PasswordRecoveryRepositoryError::InvalidToken => PasswordRecoveryError::InvalidToken,
        PasswordRecoveryRepositoryError::Unavailable { .. } => {
            PasswordRecoveryError::Infrastructure
        }
    }
}
