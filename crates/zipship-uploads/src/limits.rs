use std::time::Duration;

#[derive(Debug, Clone, Copy)]
pub struct UploadLimits {
    pub maximum_bytes: u64,
    pub upload_ttl: Duration,
    pub receive_lease: Duration,
}

impl Default for UploadLimits {
    fn default() -> Self {
        Self {
            maximum_bytes: 500 * 1_024 * 1_024,
            upload_ttl: Duration::from_secs(60 * 60),
            receive_lease: Duration::from_secs(60 * 60),
        }
    }
}
