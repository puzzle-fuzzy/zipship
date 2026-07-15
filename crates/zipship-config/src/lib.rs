#![forbid(unsafe_code)]

use secrecy::SecretString;
use std::{net::SocketAddr, path::PathBuf, str::FromStr, time::Duration};
use thiserror::Error;

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
    pub database_url: SecretString,
    pub database_max_connections: u32,
    pub storage_root: PathBuf,
    pub log_filter: String,
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

impl Settings {
    pub fn from_env() -> Result<Self, ConfigError> {
        Self::from_lookup(|key| std::env::var(key).ok())
    }

    pub fn from_lookup(
        mut lookup: impl FnMut(&str) -> Option<String>,
    ) -> Result<Self, ConfigError> {
        let environment = lookup("ZIPSHIP_ENV")
            .as_deref()
            .unwrap_or("development")
            .parse()?;
        let production = environment == Environment::Production;

        let database_url = required_in_production(
            &mut lookup,
            "ZIPSHIP_DATABASE_URL",
            production,
            "postgres://zipship:zipship@127.0.0.1:5432/zipship",
        )?;
        let storage_root =
            required_in_production(&mut lookup, "ZIPSHIP_STORAGE_ROOT", production, ".zipship")?;

        let upload_max_bytes =
            parse_nonzero_u64(&mut lookup, "ZIPSHIP_UPLOAD_MAX_BYTES", "524288000")?;
        if upload_max_bytes > i64::MAX as u64 {
            return Err(ConfigError::InvalidValue {
                key: "ZIPSHIP_UPLOAD_MAX_BYTES",
                value: upload_max_bytes.to_string(),
            });
        }
        let upload_ttl_secs = parse_nonzero_u64(&mut lookup, "ZIPSHIP_UPLOAD_TTL_SECS", "86400")?;
        let upload_receive_lease_secs =
            parse_nonzero_u64(&mut lookup, "ZIPSHIP_UPLOAD_RECEIVE_LEASE_SECS", "3600")?;
        if upload_receive_lease_secs > upload_ttl_secs {
            return Err(ConfigError::InvalidValue {
                key: "ZIPSHIP_UPLOAD_RECEIVE_LEASE_SECS",
                value: upload_receive_lease_secs.to_string(),
            });
        }
        let worker_poll_ms = parse_nonzero_u64(&mut lookup, "ZIPSHIP_WORKER_POLL_MS", "500")?;
        let worker_lease_secs = parse_nonzero_u64(&mut lookup, "ZIPSHIP_WORKER_LEASE_SECS", "60")?;
        if worker_lease_secs > 24 * 60 * 60 {
            return Err(ConfigError::InvalidValue {
                key: "ZIPSHIP_WORKER_LEASE_SECS",
                value: worker_lease_secs.to_string(),
            });
        }
        let worker_sweep_secs = parse_nonzero_u64(&mut lookup, "ZIPSHIP_WORKER_SWEEP_SECS", "30")?;
        let artifact_max_entries =
            parse_nonzero_usize(&mut lookup, "ZIPSHIP_ARTIFACT_MAX_ENTRIES", "25000")?;
        let artifact_max_file_bytes =
            parse_nonzero_u64(&mut lookup, "ZIPSHIP_ARTIFACT_MAX_FILE_BYTES", "134217728")?;
        let artifact_max_expanded_bytes = parse_nonzero_u64(
            &mut lookup,
            "ZIPSHIP_ARTIFACT_MAX_EXPANDED_BYTES",
            "2147483648",
        )?;
        if artifact_max_expanded_bytes < artifact_max_file_bytes {
            return Err(ConfigError::InvalidValue {
                key: "ZIPSHIP_ARTIFACT_MAX_EXPANDED_BYTES",
                value: artifact_max_expanded_bytes.to_string(),
            });
        }
        let artifact_max_path_depth =
            parse_nonzero_usize(&mut lookup, "ZIPSHIP_ARTIFACT_MAX_PATH_DEPTH", "32")?;
        let artifact_max_compression_ratio =
            parse_nonzero_u64(&mut lookup, "ZIPSHIP_ARTIFACT_MAX_COMPRESSION_RATIO", "200")?;
        let artifact_compression_ratio_grace_bytes = parse_or_default(
            &mut lookup,
            "ZIPSHIP_ARTIFACT_COMPRESSION_RATIO_GRACE_BYTES",
            "1048576",
        )?;

        let http_bind: SocketAddr =
            parse_or_default(&mut lookup, "ZIPSHIP_HTTP_BIND", "127.0.0.1:5006")?;
        let access_bind: SocketAddr =
            parse_or_default(&mut lookup, "ZIPSHIP_ACCESS_BIND", "127.0.0.1:5007")?;
        if http_bind == access_bind {
            return Err(ConfigError::InvalidValue {
                key: "ZIPSHIP_ACCESS_BIND",
                value: access_bind.to_string(),
            });
        }

        Ok(Self {
            environment,
            http_bind,
            access_bind,
            database_url: SecretString::from(database_url),
            database_max_connections: parse_or_default(
                &mut lookup,
                "ZIPSHIP_DATABASE_MAX_CONNECTIONS",
                "20",
            )?,
            storage_root: PathBuf::from(storage_root),
            log_filter: lookup("ZIPSHIP_LOG").unwrap_or_else(|| "info,sqlx=warn".to_owned()),
            worker_poll_interval: Duration::from_millis(worker_poll_ms),
            worker_lease_duration: Duration::from_secs(worker_lease_secs),
            worker_sweep_interval: Duration::from_secs(worker_sweep_secs),
            upload_max_bytes,
            upload_ttl: Duration::from_secs(upload_ttl_secs),
            upload_receive_lease: Duration::from_secs(upload_receive_lease_secs),
            artifact_max_entries,
            artifact_max_file_bytes,
            artifact_max_expanded_bytes,
            artifact_max_path_depth,
            artifact_max_compression_ratio,
            artifact_compression_ratio_grace_bytes,
        })
    }
}

fn parse_nonzero_u64(
    lookup: &mut impl FnMut(&str) -> Option<String>,
    key: &'static str,
    default: &str,
) -> Result<u64, ConfigError> {
    let value = lookup(key).unwrap_or_else(|| default.to_owned());
    match value.parse::<u64>() {
        Ok(parsed) if parsed > 0 => Ok(parsed),
        _ => Err(ConfigError::InvalidValue { key, value }),
    }
}

fn parse_nonzero_usize(
    lookup: &mut impl FnMut(&str) -> Option<String>,
    key: &'static str,
    default: &str,
) -> Result<usize, ConfigError> {
    let value = lookup(key).unwrap_or_else(|| default.to_owned());
    match value.parse::<usize>() {
        Ok(parsed) if parsed > 0 => Ok(parsed),
        _ => Err(ConfigError::InvalidValue { key, value }),
    }
}

fn required_in_production(
    lookup: &mut impl FnMut(&str) -> Option<String>,
    key: &'static str,
    production: bool,
    development_default: &str,
) -> Result<String, ConfigError> {
    match lookup(key).filter(|value| !value.trim().is_empty()) {
        Some(value) => Ok(value),
        None if production => Err(ConfigError::Missing(key)),
        None => Ok(development_default.to_owned()),
    }
}

fn parse_or_default<T: FromStr>(
    lookup: &mut impl FnMut(&str) -> Option<String>,
    key: &'static str,
    default: &str,
) -> Result<T, ConfigError> {
    let value = lookup(key).unwrap_or_else(|| default.to_owned());
    value
        .parse()
        .map_err(|_| ConfigError::InvalidValue { key, value })
}

#[cfg(test)]
mod tests {
    use super::*;
    use secrecy::ExposeSecret;
    use std::collections::HashMap;

    fn settings_from(entries: &[(&str, &str)]) -> Result<Settings, ConfigError> {
        let values = entries
            .iter()
            .map(|(key, value)| ((*key).to_owned(), (*value).to_owned()))
            .collect::<HashMap<_, _>>();
        Settings::from_lookup(|key| values.get(key).cloned())
    }

    #[test]
    fn development_has_safe_local_defaults() {
        let settings = settings_from(&[]).unwrap();
        assert_eq!(settings.environment, Environment::Development);
        assert_eq!(settings.http_bind.to_string(), "127.0.0.1:5006");
        assert_eq!(settings.access_bind.to_string(), "127.0.0.1:5007");
        assert_eq!(settings.storage_root, PathBuf::from(".zipship"));
        assert!(settings.database_url.expose_secret().contains("127.0.0.1"));
        assert_eq!(settings.upload_max_bytes, 500 * 1_024 * 1_024);
        assert_eq!(settings.upload_ttl, Duration::from_secs(24 * 60 * 60));
        assert_eq!(settings.upload_receive_lease, Duration::from_secs(60 * 60),);
        assert_eq!(settings.worker_sweep_interval, Duration::from_secs(30));
        assert_eq!(settings.artifact_max_entries, 25_000);
        assert_eq!(settings.artifact_max_file_bytes, 128 * 1_024 * 1_024);
        assert_eq!(
            settings.artifact_max_expanded_bytes,
            2 * 1_024 * 1_024 * 1_024,
        );
    }

    #[test]
    fn production_requires_database_and_storage_configuration() {
        assert_eq!(
            settings_from(&[("ZIPSHIP_ENV", "production")]).unwrap_err(),
            ConfigError::Missing("ZIPSHIP_DATABASE_URL"),
        );
        assert_eq!(
            settings_from(&[
                ("ZIPSHIP_ENV", "production"),
                ("ZIPSHIP_DATABASE_URL", "postgres://example"),
            ])
            .unwrap_err(),
            ConfigError::Missing("ZIPSHIP_STORAGE_ROOT"),
        );
    }

    #[test]
    fn rejects_invalid_typed_values() {
        assert!(settings_from(&[("ZIPSHIP_HTTP_BIND", "not-an-address")]).is_err());
        assert!(settings_from(&[("ZIPSHIP_ACCESS_BIND", "not-an-address")]).is_err());
        assert!(
            settings_from(&[
                ("ZIPSHIP_HTTP_BIND", "127.0.0.1:5006"),
                ("ZIPSHIP_ACCESS_BIND", "127.0.0.1:5006"),
            ])
            .is_err()
        );
        assert!(settings_from(&[("ZIPSHIP_WORKER_LEASE_SECS", "never")]).is_err());
        assert!(settings_from(&[("ZIPSHIP_WORKER_POLL_MS", "0")]).is_err());
        assert!(settings_from(&[("ZIPSHIP_WORKER_LEASE_SECS", "86401")]).is_err());
        assert!(settings_from(&[("ZIPSHIP_WORKER_SWEEP_SECS", "0")]).is_err());
        assert!(settings_from(&[("ZIPSHIP_UPLOAD_MAX_BYTES", "0")]).is_err());
        assert!(settings_from(&[("ZIPSHIP_UPLOAD_TTL_SECS", "never")]).is_err());
        assert!(
            settings_from(&[
                ("ZIPSHIP_UPLOAD_TTL_SECS", "60"),
                ("ZIPSHIP_UPLOAD_RECEIVE_LEASE_SECS", "61"),
            ])
            .is_err(),
        );
        assert!(settings_from(&[("ZIPSHIP_ARTIFACT_MAX_ENTRIES", "0")]).is_err());
        assert!(
            settings_from(&[
                ("ZIPSHIP_ARTIFACT_MAX_FILE_BYTES", "2048"),
                ("ZIPSHIP_ARTIFACT_MAX_EXPANDED_BYTES", "1024"),
            ])
            .is_err(),
        );
    }
}
