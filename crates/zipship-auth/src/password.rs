use crate::identity::validate_password;
use argon2::{
    Algorithm, Argon2, Params, Version,
    password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
};
use secrecy::{ExposeSecret, SecretString};
use std::fmt;
use thiserror::Error;

#[derive(Clone)]
pub struct EncodedPasswordHash(String);

impl EncodedPasswordHash {
    pub fn parse(value: String) -> Result<Self, PasswordHashError> {
        let parsed = PasswordHash::new(&value).map_err(|_| PasswordHashError::InvalidHash)?;
        if parsed.algorithm.as_str() != "argon2id" {
            return Err(PasswordHashError::InvalidHash);
        }
        Ok(Self(value))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Debug for EncodedPasswordHash {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("EncodedPasswordHash([redacted])")
    }
}

#[derive(Debug, Error, Clone, Copy, PartialEq, Eq)]
pub enum PasswordHashError {
    #[error("password hashing failed")]
    HashFailed,
    #[error("stored password hash is invalid")]
    InvalidHash,
}

#[derive(Debug, Clone)]
pub struct PasswordEngine {
    argon2: Argon2<'static>,
}

impl Default for PasswordEngine {
    fn default() -> Self {
        let params = Params::new(19 * 1_024, 2, 1, None)
            .expect("the fixed Argon2id parameters must be valid");
        Self {
            argon2: Argon2::new(Algorithm::Argon2id, Version::V0x13, params),
        }
    }
}

impl PasswordEngine {
    pub fn hash(&self, password: &SecretString) -> Result<EncodedPasswordHash, PasswordHashError> {
        validate_password(password.expose_secret()).map_err(|_| PasswordHashError::HashFailed)?;
        let mut salt_bytes = [0_u8; 16];
        getrandom::fill(&mut salt_bytes).map_err(|_| PasswordHashError::HashFailed)?;
        let salt =
            SaltString::encode_b64(&salt_bytes).map_err(|_| PasswordHashError::HashFailed)?;
        let encoded = self
            .argon2
            .hash_password(password.expose_secret().as_bytes(), &salt)
            .map_err(|_| PasswordHashError::HashFailed)?
            .to_string();
        EncodedPasswordHash::parse(encoded)
    }

    pub fn verify(
        &self,
        password: &SecretString,
        expected: &EncodedPasswordHash,
    ) -> Result<bool, PasswordHashError> {
        let parsed =
            PasswordHash::new(expected.as_str()).map_err(|_| PasswordHashError::InvalidHash)?;
        Ok(self
            .argon2
            .verify_password(password.expose_secret().as_bytes(), &parsed)
            .is_ok())
    }
}
