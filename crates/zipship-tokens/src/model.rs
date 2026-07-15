use crate::credential::{ApiTokenName, ApiTokenScope, ApiTokenScopes};
use secrecy::SecretString;
use std::fmt;
use time::OffsetDateTime;
use uuid::Uuid;
use zipship_auth::TokenDigest;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ApiTokenState {
    Active,
    Expired,
    Revoked,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ApiToken {
    pub id: Uuid,
    pub user_id: Uuid,
    pub name: String,
    pub display_prefix: String,
    pub scopes: Vec<ApiTokenScope>,
    pub expires_at: OffsetDateTime,
    pub last_used_at: Option<OffsetDateTime>,
    pub revoked_at: Option<OffsetDateTime>,
    pub created_at: OffsetDateTime,
}

impl ApiToken {
    pub fn state_at(&self, now: OffsetDateTime) -> ApiTokenState {
        if self.revoked_at.is_some() {
            ApiTokenState::Revoked
        } else if self.expires_at <= now {
            ApiTokenState::Expired
        } else {
            ApiTokenState::Active
        }
    }
}

#[derive(Debug, Clone)]
pub struct NewApiToken {
    pub id: Uuid,
    pub user_id: Uuid,
    pub name: ApiTokenName,
    pub display_prefix: String,
    pub scopes: ApiTokenScopes,
    pub token_digest: TokenDigest,
    pub expires_at: OffsetDateTime,
    pub created_at: OffsetDateTime,
}

pub struct IssuedApiToken {
    pub token: ApiToken,
    pub secret: SecretString,
}

impl fmt::Debug for IssuedApiToken {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("IssuedApiToken")
            .field("token", &self.token)
            .field("secret", &"[redacted]")
            .finish()
    }
}

#[derive(Debug)]
pub struct CreateApiTokenCommand {
    pub user_id: Uuid,
    pub name: String,
    pub scopes: Vec<String>,
    pub expires_in_days: u16,
}

#[derive(Debug)]
pub struct ListApiTokens {
    pub user_id: Uuid,
    pub now: OffsetDateTime,
}

#[derive(Debug)]
pub struct RevokeApiToken {
    pub user_id: Uuid,
    pub token_id: Uuid,
    pub revoked_at: OffsetDateTime,
}

#[derive(Debug)]
pub struct RevokeApiTokenCommand {
    pub user_id: Uuid,
    pub token_id: Uuid,
}

#[derive(Debug)]
pub struct ResolveApiToken {
    pub token_digest: TokenDigest,
    pub used_at: OffsetDateTime,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedApiToken {
    pub token: ApiToken,
    pub user_disabled_at: Option<OffsetDateTime>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ApiTokenPrincipal {
    pub token_id: Uuid,
    pub user_id: Uuid,
    pub scopes: ApiTokenScopes,
}

impl ApiTokenPrincipal {
    pub fn allows(&self, required: ApiTokenScope) -> bool {
        self.scopes.allows(required)
    }
}
