use secrecy::SecretString;
use std::{net::SocketAddr, path::PathBuf, str::FromStr, time::Duration};
use thiserror::Error;
use url::Url;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Environment {
    Development,
    Test,
    Production,
}

impl FromStr for Environment {
    type Err = ConfigError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value.to_ascii_lowercase().as_str() {
            "development" | "dev" => Ok(Self::Development),
            "test" => Ok(Self::Test),
            "production" | "prod" => Ok(Self::Production),
            _ => Err(ConfigError::InvalidValue {
                key: "ZIPSHIP_ENV",
                value: value.to_owned(),
            }),
        }
    }
}

#[derive(Debug)]
pub struct Settings {
    pub environment: Environment,
    pub http_bind: SocketAddr,
    pub access_bind: SocketAddr,
    pub control_allowed_origins: Vec<String>,
    pub trusted_proxy_networks: Vec<String>,
    pub console_public_url: Url,
    pub database_url: SecretString,
    pub database_max_connections: u32,
    pub storage_root: PathBuf,
    pub log_filter: String,
    pub password_recovery_active_key_id: String,
    pub password_recovery_keys: SecretString,
    pub smtp_url: SecretString,
    pub smtp_from: String,
    pub worker_poll_interval: Duration,
    pub worker_lease_duration: Duration,
    pub worker_sweep_interval: Duration,
    pub upload_max_bytes: u64,
    pub upload_ttl: Duration,
    pub upload_receive_lease: Duration,
    pub artifact_max_entries: usize,
    pub artifact_max_file_bytes: u64,
    pub artifact_max_expanded_bytes: u64,
    pub artifact_max_path_depth: usize,
    pub artifact_max_compression_ratio: u64,
    pub artifact_compression_ratio_grace_bytes: u64,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum ConfigError {
    #[error("missing required environment variable {0}")]
    Missing(&'static str),
    #[error("invalid value for {key}: {value}")]
    InvalidValue { key: &'static str, value: String },
}
