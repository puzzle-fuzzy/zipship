use std::fmt;
use thiserror::Error;

const PASSWORD_MIN_CHARS: usize = 12;
pub(crate) const PASSWORD_MAX_BYTES: usize = 1_024;
const DISPLAY_NAME_MAX_CHARS: usize = 120;
const EMAIL_MAX_BYTES: usize = 255;

#[derive(Clone, PartialEq, Eq, Hash)]
pub struct NormalizedEmail(String);

impl NormalizedEmail {
    pub fn parse(value: &str) -> Result<Self, IdentityValidationError> {
        let normalized = value.trim().to_lowercase();
        if normalized.is_empty()
            || normalized.len() > EMAIL_MAX_BYTES
            || !email_address::EmailAddress::is_valid(&normalized)
        {
            return Err(IdentityValidationError::InvalidEmail);
        }
        Ok(Self(normalized))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Debug for NormalizedEmail {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("NormalizedEmail([redacted])")
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DisplayName(String);

impl DisplayName {
    pub fn parse(value: &str) -> Result<Self, IdentityValidationError> {
        let normalized = value.trim();
        let character_count = normalized.chars().count();
        if character_count == 0
            || character_count > DISPLAY_NAME_MAX_CHARS
            || normalized.chars().any(char::is_control)
        {
            return Err(IdentityValidationError::InvalidDisplayName);
        }
        Ok(Self(normalized.to_owned()))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

#[derive(Debug, Error, Clone, Copy, PartialEq, Eq)]
pub enum IdentityValidationError {
    #[error("invalid email")]
    InvalidEmail,
    #[error("invalid display name")]
    InvalidDisplayName,
    #[error("password does not satisfy the policy")]
    InvalidPassword,
}

pub fn validate_password(password: &str) -> Result<(), IdentityValidationError> {
    if password.chars().count() < PASSWORD_MIN_CHARS || password.len() > PASSWORD_MAX_BYTES {
        return Err(IdentityValidationError::InvalidPassword);
    }
    Ok(())
}
