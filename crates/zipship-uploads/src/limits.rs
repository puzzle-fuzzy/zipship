use std::time::Duration;
use thiserror::Error;

const MINIMUM_DURATION: Duration = Duration::from_secs(1);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct UploadLimits {
    maximum_bytes: u64,
    upload_ttl: Duration,
    receive_lease: Duration,
}

#[derive(Debug, Error, Clone, Copy, PartialEq, Eq)]
pub enum UploadLimitsError {
    #[error("maximum upload size must be positive")]
    InvalidMaximumBytes,
    #[error("upload TTL must be at least one second and fit the application clock")]
    InvalidUploadTtl,
    #[error("receive lease must be at least one second and fit the application clock")]
    InvalidReceiveLease,
}

impl UploadLimits {
    pub fn new(
        maximum_bytes: u64,
        upload_ttl: Duration,
        receive_lease: Duration,
    ) -> Result<Self, UploadLimitsError> {
        if maximum_bytes == 0 {
            return Err(UploadLimitsError::InvalidMaximumBytes);
        }
        validate_duration(upload_ttl).map_err(|()| UploadLimitsError::InvalidUploadTtl)?;
        validate_duration(receive_lease).map_err(|()| UploadLimitsError::InvalidReceiveLease)?;
        Ok(Self {
            maximum_bytes,
            upload_ttl,
            receive_lease,
        })
    }

    pub const fn maximum_bytes(&self) -> u64 {
        self.maximum_bytes
    }

    pub(crate) const fn upload_ttl(&self) -> Duration {
        self.upload_ttl
    }

    pub(crate) const fn receive_lease(&self) -> Duration {
        self.receive_lease
    }
}

impl Default for UploadLimits {
    fn default() -> Self {
        Self::new(
            500 * 1_024 * 1_024,
            Duration::from_secs(60 * 60),
            Duration::from_secs(60 * 60),
        )
        .expect("default upload limits must be valid")
    }
}

fn validate_duration(duration: Duration) -> Result<(), ()> {
    if duration < MINIMUM_DURATION || time::Duration::try_from(duration).is_err() {
        return Err(());
    }
    Ok(())
}
