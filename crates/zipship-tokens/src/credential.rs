use crate::{
    constants::{
        API_TOKEN_DISPLAY_RANDOM_CHARS, API_TOKEN_NAME_MAX_CHARS, API_TOKEN_SECRET_PREFIX,
    },
    error::ApiTokensError,
};
use secrecy::{ExposeSecret, SecretString};
use std::{fmt, str::FromStr};
use thiserror::Error;
use zipship_auth::{OpaqueToken, TokenDigest, digest_token, digest_valid_opaque_token};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ApiTokenName(String);

impl ApiTokenName {
    pub fn parse(value: &str) -> Result<Self, ApiTokenValidationError> {
        let normalized = value.trim();
        let character_count = normalized.chars().count();
        if character_count == 0
            || character_count > API_TOKEN_NAME_MAX_CHARS
            || normalized.chars().any(char::is_control)
        {
            return Err(ApiTokenValidationError::InvalidName);
        }
        Ok(Self(normalized.to_owned()))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum ApiTokenScope {
    ProjectsRead,
    ReleasesRead,
    UploadsWrite,
    DeploymentsWrite,
}

impl ApiTokenScope {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::ProjectsRead => "projects:read",
            Self::ReleasesRead => "releases:read",
            Self::UploadsWrite => "uploads:write",
            Self::DeploymentsWrite => "deployments:write",
        }
    }

    pub const fn all() -> [Self; 4] {
        [
            Self::ProjectsRead,
            Self::ReleasesRead,
            Self::UploadsWrite,
            Self::DeploymentsWrite,
        ]
    }
}

impl FromStr for ApiTokenScope {
    type Err = ApiTokenValidationError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "projects:read" => Ok(Self::ProjectsRead),
            "releases:read" => Ok(Self::ReleasesRead),
            "uploads:write" => Ok(Self::UploadsWrite),
            "deployments:write" => Ok(Self::DeploymentsWrite),
            _ => Err(ApiTokenValidationError::InvalidScopes),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ApiTokenScopes(Vec<ApiTokenScope>);

impl ApiTokenScopes {
    pub fn parse(values: &[String]) -> Result<Self, ApiTokenValidationError> {
        if values.is_empty() || values.len() > ApiTokenScope::all().len() {
            return Err(ApiTokenValidationError::InvalidScopes);
        }
        let mut scopes = values
            .iter()
            .map(|value| ApiTokenScope::from_str(value))
            .collect::<Result<Vec<_>, _>>()?;
        scopes.sort_unstable();
        if scopes.windows(2).any(|pair| pair[0] == pair[1]) {
            return Err(ApiTokenValidationError::InvalidScopes);
        }
        Ok(Self(scopes))
    }

    pub fn from_stored(values: Vec<ApiTokenScope>) -> Result<Self, ApiTokenValidationError> {
        let strings = values
            .into_iter()
            .map(|scope| scope.as_str().to_owned())
            .collect::<Vec<_>>();
        Self::parse(&strings)
    }

    pub fn as_slice(&self) -> &[ApiTokenScope] {
        &self.0
    }

    pub fn allows(&self, required: ApiTokenScope) -> bool {
        self.0.binary_search(&required).is_ok()
    }
}

#[derive(Debug, Error, Clone, Copy, PartialEq, Eq)]
pub enum ApiTokenValidationError {
    #[error("api token name is invalid")]
    InvalidName,
    #[error("api token scopes are invalid")]
    InvalidScopes,
    #[error("api token expiration is invalid")]
    InvalidExpiration,
}

pub struct ApiTokenCredential {
    secret: SecretString,
    digest: TokenDigest,
    display_prefix: String,
}

impl ApiTokenCredential {
    pub fn generate() -> Result<Self, ApiTokensError> {
        let opaque = OpaqueToken::generate().map_err(|_| ApiTokensError::Infrastructure)?;
        let random_secret = opaque.secret().expose_secret();
        let secret = SecretString::from(format!("{API_TOKEN_SECRET_PREFIX}{random_secret}"));
        let digest = digest_token(secret.expose_secret());
        let display_prefix = format!(
            "{API_TOKEN_SECRET_PREFIX}{}",
            &random_secret[..API_TOKEN_DISPLAY_RANDOM_CHARS],
        );
        Ok(Self {
            secret,
            digest,
            display_prefix,
        })
    }

    pub fn secret(&self) -> &SecretString {
        &self.secret
    }

    pub fn digest(&self) -> TokenDigest {
        self.digest
    }

    pub fn display_prefix(&self) -> &str {
        &self.display_prefix
    }

    pub fn into_secret(self) -> SecretString {
        self.secret
    }
}

impl fmt::Debug for ApiTokenCredential {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ApiTokenCredential")
            .field("secret", &"[redacted]")
            .field("digest", &"[redacted]")
            .field("display_prefix", &self.display_prefix)
            .finish()
    }
}

pub fn digest_valid_api_token(value: &str) -> Option<TokenDigest> {
    let random_secret = value.strip_prefix(API_TOKEN_SECRET_PREFIX)?;
    digest_valid_opaque_token(random_secret)?;
    Some(digest_token(value))
}
