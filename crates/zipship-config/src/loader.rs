use crate::{
    model::{ConfigError, Environment, Settings},
    parsers::{
        parse_console_public_url, parse_nonzero_u32, parse_nonzero_u64, parse_nonzero_usize,
        parse_optional_list, parse_or_default, parse_origins, required_in_production,
        validate_smtp_url,
    },
};
use secrecy::SecretString;
use std::{net::SocketAddr, path::PathBuf, time::Duration};

const DEVELOPMENT_CONTROL_ORIGINS: &str =
    "http://127.0.0.1:4015,http://127.0.0.1:1420,http://localhost:1420";
const DEVELOPMENT_RECOVERY_KEY: &str = "development:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

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
        let control_allowed_origins = parse_origins(
            required_in_production(
                &mut lookup,
                "ZIPSHIP_CONTROL_ALLOWED_ORIGINS",
                production,
                DEVELOPMENT_CONTROL_ORIGINS,
            )?,
            production,
        )?;
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
            database_max_connections: parse_nonzero_u32(
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
