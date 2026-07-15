use crate::model::{ConsumePasswordReset, NewPasswordReset, PasswordResetRequestDisposition};
use async_trait::async_trait;
use std::error::Error as StdError;
use thiserror::Error;
use time::OffsetDateTime;

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
