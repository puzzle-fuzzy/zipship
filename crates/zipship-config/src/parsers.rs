use crate::model::ConfigError;
use std::str::FromStr;
use url::Url;

pub(crate) fn parse_console_public_url(
    value: String,
    production: bool,
) -> Result<Url, ConfigError> {
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

pub(crate) fn validate_smtp_url(value: String, production: bool) -> Result<String, ConfigError> {
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

pub(crate) fn parse_origins(value: String, production: bool) -> Result<Vec<String>, ConfigError> {
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
            || (production && url.scheme() != "https")
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

pub(crate) fn parse_optional_list(
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

pub(crate) fn parse_nonzero_u64(
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

pub(crate) fn parse_nonzero_u32(
    lookup: &mut impl FnMut(&str) -> Option<String>,
    key: &'static str,
    default: &str,
) -> Result<u32, ConfigError> {
    let value = lookup(key).unwrap_or_else(|| default.to_owned());
    match value.parse::<u32>() {
        Ok(parsed) if parsed > 0 => Ok(parsed),
        _ => Err(ConfigError::InvalidValue { key, value }),
    }
}

pub(crate) fn parse_nonzero_usize(
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

pub(crate) fn required_in_production(
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

pub(crate) fn parse_or_default<T: FromStr>(
    lookup: &mut impl FnMut(&str) -> Option<String>,
    key: &'static str,
    default: &str,
) -> Result<T, ConfigError> {
    let value = lookup(key).unwrap_or_else(|| default.to_owned());
    value
        .parse()
        .map_err(|_| ConfigError::InvalidValue { key, value })
}
