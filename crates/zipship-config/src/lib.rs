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
    pub database_url: SecretString,
    pub database_max_connections: u32,
    pub storage_root: PathBuf,
    pub log_filter: String,
    pub worker_poll_interval: Duration,
    pub worker_lease_duration: Duration,
    pub upload_max_bytes: u64,
    pub upload_ttl: Duration,
    pub upload_receive_lease: Duration,
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

        Ok(Self {
            environment,
            http_bind: parse_or_default(&mut lookup, "ZIPSHIP_HTTP_BIND", "127.0.0.1:5006")?,
            database_url: SecretString::from(database_url),
            database_max_connections: parse_or_default(
                &mut lookup,
                "ZIPSHIP_DATABASE_MAX_CONNECTIONS",
                "20",
            )?,
            storage_root: PathBuf::from(storage_root),
            log_filter: lookup("ZIPSHIP_LOG").unwrap_or_else(|| "info,sqlx=warn".to_owned()),
            worker_poll_interval: Duration::from_millis(parse_or_default(
                &mut lookup,
                "ZIPSHIP_WORKER_POLL_MS",
                "500",
            )?),
            worker_lease_duration: Duration::from_secs(parse_or_default(
                &mut lookup,
                "ZIPSHIP_WORKER_LEASE_SECS",
                "60",
            )?),
            upload_max_bytes,
            upload_ttl: Duration::from_secs(upload_ttl_secs),
            upload_receive_lease: Duration::from_secs(upload_receive_lease_secs),
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
        assert_eq!(settings.storage_root, PathBuf::from(".zipship"));
        assert!(settings.database_url.expose_secret().contains("127.0.0.1"));
        assert_eq!(settings.upload_max_bytes, 500 * 1_024 * 1_024);
        assert_eq!(settings.upload_ttl, Duration::from_secs(24 * 60 * 60));
        assert_eq!(settings.upload_receive_lease, Duration::from_secs(60 * 60),);
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
        assert!(settings_from(&[("ZIPSHIP_WORKER_LEASE_SECS", "never")]).is_err());
        assert!(settings_from(&[("ZIPSHIP_UPLOAD_MAX_BYTES", "0")]).is_err());
        assert!(settings_from(&[("ZIPSHIP_UPLOAD_TTL_SECS", "never")]).is_err());
        assert!(
            settings_from(&[
                ("ZIPSHIP_UPLOAD_TTL_SECS", "60"),
                ("ZIPSHIP_UPLOAD_RECEIVE_LEASE_SECS", "61"),
            ])
            .is_err(),
        );
    }
}
