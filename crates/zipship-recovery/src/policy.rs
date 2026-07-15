use crate::constants::{
    DEFAULT_MAX_REQUESTS_PER_WINDOW, DEFAULT_OUTBOX_MAX_ATTEMPTS, DEFAULT_REQUEST_COOLDOWN,
    DEFAULT_REQUEST_WINDOW, DEFAULT_RESET_TTL,
};
use time::Duration;

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
    pub(crate) fn validate(self) {
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
