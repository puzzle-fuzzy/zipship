use sqlx::FromRow;
use std::str::FromStr;
use time::OffsetDateTime;
use uuid::Uuid;
use zipship_tokens::{
    ApiToken, ApiTokenName, ApiTokenScope, ApiTokenScopes, ApiTokensRepositoryError,
};

#[derive(Debug, FromRow)]
pub(super) struct ApiTokenRow {
    id: Uuid,
    user_id: Uuid,
    name: String,
    display_prefix: String,
    scopes: Vec<String>,
    expires_at: OffsetDateTime,
    last_used_at: Option<OffsetDateTime>,
    pub(super) revoked_at: Option<OffsetDateTime>,
    created_at: OffsetDateTime,
}

impl ApiTokenRow {
    pub(super) fn try_into_token(self) -> Result<ApiToken, ApiTokensRepositoryError> {
        let name = ApiTokenName::parse(&self.name).map_err(|_| corrupt_record())?;
        if name.as_str() != self.name || !valid_display_prefix(&self.display_prefix) {
            return Err(corrupt_record());
        }
        let parsed_scopes = self
            .scopes
            .iter()
            .map(|scope| ApiTokenScope::from_str(scope))
            .collect::<Result<Vec<_>, _>>()
            .map_err(|_| corrupt_record())?;
        let scopes = ApiTokenScopes::from_stored(parsed_scopes).map_err(|_| corrupt_record())?;
        Ok(ApiToken {
            id: self.id,
            user_id: self.user_id,
            name: name.as_str().to_owned(),
            display_prefix: self.display_prefix,
            scopes: scopes.as_slice().to_vec(),
            expires_at: self.expires_at,
            last_used_at: self.last_used_at,
            revoked_at: self.revoked_at,
            created_at: self.created_at,
        })
    }
}

pub(super) fn valid_display_prefix(value: &str) -> bool {
    value.len() == 12
        && value.starts_with("zps_")
        && value[4..]
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
}

pub(super) fn corrupt_record() -> ApiTokensRepositoryError {
    ApiTokensRepositoryError::unavailable(CorruptApiTokenRecord)
}

#[derive(Debug)]
struct CorruptApiTokenRecord;

impl std::fmt::Display for CorruptApiTokenRecord {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("database returned an invalid api token record")
    }
}

impl std::error::Error for CorruptApiTokenRecord {}
