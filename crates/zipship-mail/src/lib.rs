#![forbid(unsafe_code)]

use async_trait::async_trait;
use lettre::{
    AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor,
    message::{Mailbox, header::ContentType},
};
use secrecy::{ExposeSecret, SecretString};
use std::{error::Error as StdError, fmt, sync::Arc};
use thiserror::Error;
use time::OffsetDateTime;
use tokio::time::{MissedTickBehavior, interval};
use url::Url;
use uuid::Uuid;
use zipship_jobs::{JobLease, WorkerId, retry_delay};
use zipship_recovery::{Clock, EnvelopeKeyRing, SealedEnvelope, SystemClock};

#[derive(Debug, Clone)]
pub struct ClaimedMail {
    pub outbox_id: Uuid,
    pub request_id: Uuid,
    pub envelope: SealedEnvelope,
    pub attempt: u16,
    pub max_attempts: u16,
    pub expires_at: OffsetDateTime,
}

#[derive(Debug, Error)]
pub enum MailOutboxRepositoryError {
    #[error("mail outbox lease was lost")]
    LeaseLost,
    #[error("mail outbox repository is unavailable")]
    Unavailable {
        #[source]
        source: Box<dyn StdError + Send + Sync>,
    },
}

impl MailOutboxRepositoryError {
    pub fn unavailable(source: impl StdError + Send + Sync + 'static) -> Self {
        Self::Unavailable {
            source: Box::new(source),
        }
    }
}

#[async_trait]
pub trait MailOutboxRepository: Send + Sync + 'static {
    async fn claim_next(
        &self,
        worker_id: &WorkerId,
        lease: JobLease,
        now: OffsetDateTime,
    ) -> Result<Option<ClaimedMail>, MailOutboxRepositoryError>;

    async fn heartbeat(
        &self,
        outbox_id: Uuid,
        worker_id: &WorkerId,
        lease: JobLease,
        now: OffsetDateTime,
    ) -> Result<bool, MailOutboxRepositoryError>;

    async fn mark_delivered(
        &self,
        outbox_id: Uuid,
        worker_id: &WorkerId,
        delivered_at: OffsetDateTime,
    ) -> Result<bool, MailOutboxRepositoryError>;

    async fn mark_failed(
        &self,
        outbox_id: Uuid,
        worker_id: &WorkerId,
        error_code: &'static str,
        retry_at: Option<OffsetDateTime>,
        failed_at: OffsetDateTime,
    ) -> Result<bool, MailOutboxRepositoryError>;

    async fn sweep(&self, now: OffsetDateTime) -> Result<u64, MailOutboxRepositoryError>;
}

#[derive(Debug)]
pub struct PasswordResetMail {
    pub recipient: String,
    pub reset_url: SecretString,
}

#[derive(Debug, Error)]
#[error("password reset mail delivery failed with {code}")]
pub struct MailDeliveryError {
    code: &'static str,
    retryable: bool,
    #[source]
    source: Option<Box<dyn StdError + Send + Sync>>,
}

impl MailDeliveryError {
    pub fn new(code: &'static str, retryable: bool) -> Self {
        Self {
            code,
            retryable,
            source: None,
        }
    }

    pub fn with_source(
        code: &'static str,
        retryable: bool,
        source: impl StdError + Send + Sync + 'static,
    ) -> Self {
        Self {
            code,
            retryable,
            source: Some(Box::new(source)),
        }
    }

    pub const fn code(&self) -> &'static str {
        self.code
    }

    pub const fn retryable(&self) -> bool {
        self.retryable
    }
}

#[async_trait]
pub trait PasswordResetMailer: Send + Sync + 'static {
    async fn send(&self, mail: &PasswordResetMail) -> Result<(), MailDeliveryError>;
}

#[derive(Clone)]
pub struct SmtpPasswordResetMailer {
    transport: AsyncSmtpTransport<Tokio1Executor>,
    from: Mailbox,
}

impl fmt::Debug for SmtpPasswordResetMailer {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("SmtpPasswordResetMailer")
            .field("transport", &"[redacted]")
            .field("from", &self.from)
            .finish()
    }
}

impl SmtpPasswordResetMailer {
    pub fn new(smtp_url: &SecretString, from: &str) -> Result<Self, MailDeliveryError> {
        let from = from
            .parse::<Mailbox>()
            .map_err(|error| MailDeliveryError::with_source("MAIL_FROM_INVALID", false, error))?;
        let transport = AsyncSmtpTransport::<Tokio1Executor>::from_url(smtp_url.expose_secret())
            .map_err(|error| {
                MailDeliveryError::with_source("SMTP_CONFIGURATION_INVALID", false, error)
            })?
            .timeout(Some(std::time::Duration::from_secs(30)))
            .build();
        Ok(Self { transport, from })
    }
}

#[async_trait]
impl PasswordResetMailer for SmtpPasswordResetMailer {
    async fn send(&self, mail: &PasswordResetMail) -> Result<(), MailDeliveryError> {
        let message = build_password_reset_message(&self.from, mail)?;
        self.transport
            .send(message)
            .await
            .map(|_| ())
            .map_err(|error| {
                let retryable = !error.is_permanent();
                MailDeliveryError::with_source("SMTP_DELIVERY_FAILED", retryable, error)
            })
    }
}

fn build_password_reset_message(
    from: &Mailbox,
    mail: &PasswordResetMail,
) -> Result<Message, MailDeliveryError> {
    let recipient = mail
        .recipient
        .parse::<Mailbox>()
        .map_err(|error| MailDeliveryError::with_source("MAIL_RECIPIENT_INVALID", false, error))?;
    let body = format!(
        "A password reset was requested for your ZipShip account.\n\nOpen this link to choose a new password:\n{}\n\nThis link expires in 30 minutes. If you did not request this change, ignore this email.\n",
        mail.reset_url.expose_secret()
    );
    Message::builder()
        .from(from.clone())
        .to(recipient)
        .subject("Reset your ZipShip password")
        .header(ContentType::TEXT_PLAIN)
        .body(body)
        .map_err(|error| MailDeliveryError::with_source("MAIL_BUILD_FAILED", false, error))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MailWorkOutcome {
    Idle,
    Delivered { outbox_id: Uuid },
    RetryScheduled { outbox_id: Uuid },
    Failed { outbox_id: Uuid },
    LeaseLost { outbox_id: Uuid },
}

#[derive(Debug, Error)]
pub enum MailWorkerError {
    #[error("mail outbox repository failed")]
    Repository(#[source] MailOutboxRepositoryError),
    #[error("public console URL cannot create a reset route")]
    InvalidConsoleUrl,
}

#[derive(Clone)]
pub struct PasswordResetMailWorker {
    repository: Arc<dyn MailOutboxRepository>,
    mailer: Arc<dyn PasswordResetMailer>,
    key_ring: EnvelopeKeyRing,
    console_url: Url,
    worker_id: WorkerId,
    lease: JobLease,
    clock: Arc<dyn Clock>,
}

impl PasswordResetMailWorker {
    pub fn new(
        repository: Arc<dyn MailOutboxRepository>,
        mailer: Arc<dyn PasswordResetMailer>,
        key_ring: EnvelopeKeyRing,
        console_url: Url,
        worker_id: WorkerId,
        lease: JobLease,
    ) -> Self {
        Self::with_clock(
            repository,
            mailer,
            key_ring,
            console_url,
            worker_id,
            lease,
            Arc::new(SystemClock),
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub fn with_clock(
        repository: Arc<dyn MailOutboxRepository>,
        mailer: Arc<dyn PasswordResetMailer>,
        key_ring: EnvelopeKeyRing,
        console_url: Url,
        worker_id: WorkerId,
        lease: JobLease,
        clock: Arc<dyn Clock>,
    ) -> Self {
        Self {
            repository,
            mailer,
            key_ring,
            console_url,
            worker_id,
            lease,
            clock,
        }
    }

    pub async fn process_next(&self) -> Result<MailWorkOutcome, MailWorkerError> {
        let Some(claimed) = self
            .repository
            .claim_next(&self.worker_id, self.lease, self.clock.now())
            .await
            .map_err(MailWorkerError::Repository)?
        else {
            return Ok(MailWorkOutcome::Idle);
        };
        let delivery = match self
            .key_ring
            .open_password_reset(claimed.request_id, &claimed.envelope)
        {
            Ok(delivery) => delivery,
            Err(_) => {
                return self
                    .fail_claim(&claimed, "MAIL_ENVELOPE_INVALID", false)
                    .await;
            }
        };
        let mut reset_url = self
            .console_url
            .join("reset-password")
            .map_err(|_| MailWorkerError::InvalidConsoleUrl)?;
        reset_url.set_fragment(Some(&format!("token={}", delivery.token.expose_secret())));
        let mail = PasswordResetMail {
            recipient: delivery.recipient.as_str().to_owned(),
            reset_url: SecretString::from(reset_url.to_string()),
        };
        let send_result = self.send_with_heartbeat(claimed.outbox_id, &mail).await;
        match send_result {
            Ok(()) => {
                let owned = self
                    .repository
                    .mark_delivered(claimed.outbox_id, &self.worker_id, self.clock.now())
                    .await
                    .map_err(MailWorkerError::Repository)?;
                Ok(if owned {
                    MailWorkOutcome::Delivered {
                        outbox_id: claimed.outbox_id,
                    }
                } else {
                    MailWorkOutcome::LeaseLost {
                        outbox_id: claimed.outbox_id,
                    }
                })
            }
            Err(SendWithHeartbeatError::LeaseLost) => Ok(MailWorkOutcome::LeaseLost {
                outbox_id: claimed.outbox_id,
            }),
            Err(SendWithHeartbeatError::Repository(error)) => {
                Err(MailWorkerError::Repository(error))
            }
            Err(SendWithHeartbeatError::Delivery(error)) => {
                self.fail_claim(&claimed, error.code(), error.retryable())
                    .await
            }
        }
    }

    pub async fn sweep(&self) -> Result<u64, MailWorkerError> {
        self.repository
            .sweep(self.clock.now())
            .await
            .map_err(MailWorkerError::Repository)
    }

    async fn send_with_heartbeat(
        &self,
        outbox_id: Uuid,
        mail: &PasswordResetMail,
    ) -> Result<(), SendWithHeartbeatError> {
        let heartbeat_period = self
            .lease
            .duration()
            .checked_div(3)
            .unwrap_or(std::time::Duration::from_secs(1))
            .max(std::time::Duration::from_secs(1));
        let mut heartbeat = interval(heartbeat_period);
        heartbeat.set_missed_tick_behavior(MissedTickBehavior::Delay);
        heartbeat.tick().await;
        let delivery = self.mailer.send(mail);
        tokio::pin!(delivery);
        loop {
            tokio::select! {
                result = &mut delivery => return result.map_err(SendWithHeartbeatError::Delivery),
                _ = heartbeat.tick() => {
                    let owned = self.repository
                        .heartbeat(outbox_id, &self.worker_id, self.lease, self.clock.now())
                        .await
                        .map_err(SendWithHeartbeatError::Repository)?;
                    if !owned {
                        return Err(SendWithHeartbeatError::LeaseLost);
                    }
                }
            }
        }
    }

    async fn fail_claim(
        &self,
        claimed: &ClaimedMail,
        error_code: &'static str,
        retryable: bool,
    ) -> Result<MailWorkOutcome, MailWorkerError> {
        let now = self.clock.now();
        let retry_at =
            (retryable && claimed.attempt < claimed.max_attempts && now < claimed.expires_at)
                .then(|| now + retry_delay(u32::from(claimed.attempt)));
        let owned = self
            .repository
            .mark_failed(
                claimed.outbox_id,
                &self.worker_id,
                error_code,
                retry_at,
                now,
            )
            .await
            .map_err(MailWorkerError::Repository)?;
        if !owned {
            return Ok(MailWorkOutcome::LeaseLost {
                outbox_id: claimed.outbox_id,
            });
        }
        Ok(if retry_at.is_some() {
            MailWorkOutcome::RetryScheduled {
                outbox_id: claimed.outbox_id,
            }
        } else {
            MailWorkOutcome::Failed {
                outbox_id: claimed.outbox_id,
            }
        })
    }
}

enum SendWithHeartbeatError {
    Delivery(MailDeliveryError),
    Repository(MailOutboxRepositoryError),
    LeaseLost,
}

#[cfg(test)]
mod tests;
