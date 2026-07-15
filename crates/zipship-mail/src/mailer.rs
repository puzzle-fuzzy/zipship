use async_trait::async_trait;
use lettre::{
    AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor,
    message::{Mailbox, header::ContentType},
};
use secrecy::{ExposeSecret, SecretString};
use std::{error::Error as StdError, fmt};
use thiserror::Error;

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

pub(crate) fn build_password_reset_message(
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
