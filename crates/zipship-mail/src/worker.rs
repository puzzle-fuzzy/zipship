use crate::{
    mailer::{MailDeliveryError, PasswordResetMail, PasswordResetMailer},
    repository::{ClaimedMail, MailOutboxRepository, MailOutboxRepositoryError},
};
use secrecy::{ExposeSecret, SecretString};
use std::sync::Arc;
use thiserror::Error;
use tokio::time::{MissedTickBehavior, interval};
use url::Url;
use uuid::Uuid;
use zipship_jobs::{JobLease, WorkerId, retry_delay};
use zipship_recovery::{Clock, EnvelopeKeyRing, SystemClock};

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
