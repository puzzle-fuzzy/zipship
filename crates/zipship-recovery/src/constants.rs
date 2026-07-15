use time::Duration;

pub(crate) const DEFAULT_RESET_TTL: Duration = Duration::minutes(30);
pub(crate) const DEFAULT_REQUEST_COOLDOWN: Duration = Duration::minutes(1);
pub(crate) const DEFAULT_REQUEST_WINDOW: Duration = Duration::hours(1);
pub(crate) const DEFAULT_MAX_REQUESTS_PER_WINDOW: u16 = 5;
pub(crate) const DEFAULT_OUTBOX_MAX_ATTEMPTS: u16 = 8;
pub(crate) const DUMMY_EMAIL: &str = "password-recovery-dummy@invalid.example";
pub(crate) const ENVELOPE_PURPOSE: &[u8] = b"zipship:password-reset:v1:";
