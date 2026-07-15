#![forbid(unsafe_code)]

use secrecy::SecretString;
use std::{net::SocketAddr, path::PathBuf, str::FromStr, time::Duration};
use thiserror::Error;
use url::Url;

const DEVELOPMENT_CONTROL_ORIGINS: &str =
    "http://127.0.0.1:4015,http://127.0.0.1:1420,http://localhost:1420";
const DEVELOPMENT_RECOVERY_KEY: &str = "development:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

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
        let control_allowed_origins = parse_origins(required_in_production(
            &mut lookup,
            "ZIPSHIP_CONTROL_ALLOWED_ORIGINS",
            production,
            DEVELOPMENT_CONTROL_ORIGINS,
        )?)?;
        let trusted_proxy_networks = parse_optional_list(
            lookup("ZIPSHIP_TRUSTED_PROXY_NETWORKS"),
            "ZIPSHIP_TRUSTED_PROXY_NETWORKS",
        )?;
        let console_public_url = parse_console_public_url(
            required_in_production(
                &mut lookup,
                "ZIPSHIP_CONSOLE_PUBLIC_URL",
                production,
                "http://127.0.0.1:4015/",
            )?,
            production,
        )?;
        let password_recovery_active_key_id = required_in_production(
            &mut lookup,
            "ZIPSHIP_PASSWORD_RECOVERY_ACTIVE_KEY_ID",
            production,
            "development",
        )?;
        let password_recovery_keys = required_in_production(
            &mut lookup,
            "ZIPSHIP_PASSWORD_RECOVERY_KEYS",
            production,
            DEVELOPMENT_RECOVERY_KEY,
        )?;
        let smtp_url = validate_smtp_url(
            required_in_production(
                &mut lookup,
                "ZIPSHIP_SMTP_URL",
                production,
                "smtp://127.0.0.1:1025",
            )?,
            production,
        )?;
        let smtp_from = required_in_production(
            &mut lookup,
            "ZIPSHIP_SMTP_FROM",
            production,
            "ZipShip <security@localhost>",
        )?;

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
            control_allowed_origins,
            trusted_proxy_networks,
            console_public_url,
            database_url: SecretString::from(database_url),
            database_max_connections: parse_or_default(
                &mut lookup,
                "ZIPSHIP_DATABASE_MAX_CONNECTIONS",
                "20",
            )?,
            storage_root: PathBuf::from(storage_root),
            log_filter: lookup("ZIPSHIP_LOG").unwrap_or_else(|| "info,sqlx=warn".to_owned()),
            password_recovery_active_key_id,
            password_recovery_keys: SecretString::from(password_recovery_keys),
            smtp_url: SecretString::from(smtp_url),
            smtp_from,
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

fn parse_console_public_url(value: String, production: bool) -> Result<Url, ConfigError> {
    let invalid = || ConfigError::InvalidValue {
        key: "ZIPSHIP_CONSOLE_PUBLIC_URL",
        value: value.clone(),
    };
    let url = Url::parse(&value).map_err(|_| invalid())?;
    if !matches!(url.scheme(), "http" | "https")
        || url.host().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.path() != "/"
        || url.query().is_some()
        || url.fragment().is_some()
        || (production && url.scheme() != "https")
    {
        return Err(invalid());
    }
    Ok(url)
}

fn validate_smtp_url(value: String, production: bool) -> Result<String, ConfigError> {
    let invalid = || ConfigError::InvalidValue {
        key: "ZIPSHIP_SMTP_URL",
        value: "[redacted]".to_owned(),
    };
    let url = Url::parse(&value).map_err(|_| invalid())?;
    let secure = url.scheme() == "smtps"
        || (url.scheme() == "smtp"
            && url
                .query_pairs()
                .any(|(key, value)| key == "tls" && value == "required"));
    if !matches!(url.scheme(), "smtp" | "smtps")
        || url.host().is_none()
        || url.fragment().is_some()
        || (production && !secure)
    {
        return Err(invalid());
    }
    Ok(value)
}

fn parse_origins(value: String) -> Result<Vec<String>, ConfigError> {
    let invalid = || ConfigError::InvalidValue {
        key: "ZIPSHIP_CONTROL_ALLOWED_ORIGINS",
        value: value.clone(),
    };
    let mut origins = Vec::new();
    for candidate in value.split(',').map(str::trim) {
        if candidate.is_empty() {
            return Err(invalid());
        }
        let url = Url::parse(candidate).map_err(|_| invalid())?;
        if !matches!(url.scheme(), "http" | "https")
            || url.host().is_none()
            || !url.username().is_empty()
            || url.password().is_some()
            || url.path() != "/"
            || url.query().is_some()
            || url.fragment().is_some()
        {
            return Err(invalid());
        }
        let origin = url.origin().ascii_serialization();
        if origin == "null" {
            return Err(invalid());
        }
        if !origins.contains(&origin) {
            origins.push(origin);
        }
    }
    if origins.is_empty() {
        return Err(invalid());
    }
    Ok(origins)
}

fn parse_optional_list(
    value: Option<String>,
    key: &'static str,
) -> Result<Vec<String>, ConfigError> {
    let Some(value) = value else {
        return Ok(Vec::new());
    };
    if value.trim().is_empty() {
        return Ok(Vec::new());
    }
    let mut entries = Vec::new();
    for candidate in value.split(',').map(str::trim) {
        if candidate.is_empty() {
            return Err(ConfigError::InvalidValue {
                key,
                value: value.clone(),
            });
        }
        if !entries.iter().any(|entry| entry == candidate) {
            entries.push(candidate.to_owned());
        }
    }
    Ok(entries)
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
        assert_eq!(
            settings.control_allowed_origins,
            [
                "http://127.0.0.1:4015",
                "http://127.0.0.1:1420",
                "http://localhost:1420"
            ]
        );
        assert_eq!(settings.storage_root, PathBuf::from(".zipship"));
        assert!(settings.trusted_proxy_networks.is_empty());
        assert_eq!(
            settings.console_public_url.as_str(),
            "http://127.0.0.1:4015/"
        );
        assert_eq!(settings.password_recovery_active_key_id, "development");
        assert!(
            settings
                .password_recovery_keys
                .expose_secret()
                .starts_with("development:")
        );
        assert_eq!(settings.smtp_url.expose_secret(), "smtp://127.0.0.1:1025");
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
        assert_eq!(
            settings_from(&[
                ("ZIPSHIP_ENV", "production"),
                ("ZIPSHIP_DATABASE_URL", "postgres://example"),
                ("ZIPSHIP_STORAGE_ROOT", "/srv/zipship"),
            ])
            .unwrap_err(),
            ConfigError::Missing("ZIPSHIP_CONTROL_ALLOWED_ORIGINS"),
        );
    }

    #[test]
    fn production_requires_secure_password_recovery_delivery() {
        let base = [
            ("ZIPSHIP_ENV", "production"),
            ("ZIPSHIP_DATABASE_URL", "postgres://example"),
            ("ZIPSHIP_STORAGE_ROOT", "/srv/zipship"),
            (
                "ZIPSHIP_CONTROL_ALLOWED_ORIGINS",
                "https://console.example.com",
            ),
        ];
        assert_eq!(
            settings_from(&base).unwrap_err(),
            ConfigError::Missing("ZIPSHIP_CONSOLE_PUBLIC_URL")
        );
        let with_console = [
            base[0],
            base[1],
            base[2],
            base[3],
            ("ZIPSHIP_CONSOLE_PUBLIC_URL", "https://console.example.com"),
        ];
        assert_eq!(
            settings_from(&with_console).unwrap_err(),
            ConfigError::Missing("ZIPSHIP_PASSWORD_RECOVERY_ACTIVE_KEY_ID")
        );
        let with_active_key = [
            with_console[0],
            with_console[1],
            with_console[2],
            with_console[3],
            with_console[4],
            ("ZIPSHIP_PASSWORD_RECOVERY_ACTIVE_KEY_ID", "primary"),
        ];
        assert_eq!(
            settings_from(&with_active_key).unwrap_err(),
            ConfigError::Missing("ZIPSHIP_PASSWORD_RECOVERY_KEYS")
        );
        let with_keys = [
            with_active_key[0],
            with_active_key[1],
            with_active_key[2],
            with_active_key[3],
            with_active_key[4],
            with_active_key[5],
            (
                "ZIPSHIP_PASSWORD_RECOVERY_KEYS",
                "primary:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
            ),
        ];
        assert_eq!(
            settings_from(&with_keys).unwrap_err(),
            ConfigError::Missing("ZIPSHIP_SMTP_URL")
        );
        let with_smtp = [
            with_keys[0],
            with_keys[1],
            with_keys[2],
            with_keys[3],
            with_keys[4],
            with_keys[5],
            with_keys[6],
            (
                "ZIPSHIP_SMTP_URL",
                "smtp://smtp.example.com:587?tls=required",
            ),
        ];
        assert_eq!(
            settings_from(&with_smtp).unwrap_err(),
            ConfigError::Missing("ZIPSHIP_SMTP_FROM")
        );
        let complete = [
            with_smtp[0],
            with_smtp[1],
            with_smtp[2],
            with_smtp[3],
            with_smtp[4],
            with_smtp[5],
            with_smtp[6],
            with_smtp[7],
            ("ZIPSHIP_SMTP_FROM", "ZipShip <security@example.com>"),
        ];
        assert!(settings_from(&complete).is_ok());
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
        for origins in ["*", "http://example.com/path", "https://user@example.com"] {
            assert!(
                settings_from(&[("ZIPSHIP_CONTROL_ALLOWED_ORIGINS", origins)]).is_err(),
                "{origins}"
            );
        }
        assert!(
            settings_from(&[("ZIPSHIP_CONSOLE_PUBLIC_URL", "http://example.com/path")]).is_err()
        );
        assert!(settings_from(&[("ZIPSHIP_SMTP_URL", "http://example.com")]).is_err());
        assert!(settings_from(&[("ZIPSHIP_TRUSTED_PROXY_NETWORKS", "10.0.0.0/8,,::1")]).is_err());
        assert!(
            settings_from(&[
                ("ZIPSHIP_ENV", "production"),
                ("ZIPSHIP_DATABASE_URL", "postgres://example"),
                ("ZIPSHIP_STORAGE_ROOT", "/srv/zipship"),
                (
                    "ZIPSHIP_CONTROL_ALLOWED_ORIGINS",
                    "https://console.example.com",
                ),
                ("ZIPSHIP_CONSOLE_PUBLIC_URL", "https://console.example.com"),
                ("ZIPSHIP_PASSWORD_RECOVERY_ACTIVE_KEY_ID", "primary"),
                (
                    "ZIPSHIP_PASSWORD_RECOVERY_KEYS",
                    "primary:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
                ),
                ("ZIPSHIP_SMTP_URL", "smtp://smtp.example.com:587"),
                ("ZIPSHIP_SMTP_FROM", "ZipShip <security@example.com>"),
            ])
            .is_err()
        );
        assert!(
            settings_from(&[
                ("ZIPSHIP_ARTIFACT_MAX_FILE_BYTES", "2048"),
                ("ZIPSHIP_ARTIFACT_MAX_EXPANDED_BYTES", "1024"),
            ])
            .is_err(),
        );
    }
}
