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
    assert!(settings_from(&[("ZIPSHIP_CONSOLE_PUBLIC_URL", "http://example.com/path")]).is_err());
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
