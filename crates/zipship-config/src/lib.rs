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
        })
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
    }
}
