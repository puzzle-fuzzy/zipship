#![forbid(unsafe_code)]

use argon2::{
    Algorithm, Argon2, Params, Version,
    password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use secrecy::{ExposeSecret, SecretString};
use sha2::{Digest, Sha256};
use std::fmt;
use subtle::ConstantTimeEq;
use thiserror::Error;

mod service;

pub use service::*;

const PASSWORD_MIN_CHARS: usize = 12;
const PASSWORD_MAX_BYTES: usize = 1_024;
const DISPLAY_NAME_MAX_CHARS: usize = 120;
const EMAIL_MAX_BYTES: usize = 255;
const TOKEN_BYTES: usize = 32;

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

#[derive(Clone, Copy, PartialEq, Eq)]
pub struct TokenDigest([u8; 32]);

impl TokenDigest {
    pub fn from_slice(value: &[u8]) -> Option<Self> {
        value.try_into().ok().map(Self)
    }

    pub fn as_bytes(&self) -> &[u8; 32] {
        &self.0
    }
}

impl fmt::Debug for TokenDigest {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("TokenDigest([redacted])")
    }
}

pub struct OpaqueToken {
    secret: SecretString,
    digest: TokenDigest,
}

impl OpaqueToken {
    pub fn generate() -> Result<Self, TokenGenerationError> {
        let secret = generate_opaque_token()?;
        let digest = digest_token(secret.expose_secret());
        Ok(Self { secret, digest })
    }

    pub fn secret(&self) -> &SecretString {
        &self.secret
    }

    pub fn digest(&self) -> TokenDigest {
        self.digest
    }

    pub fn into_secret(self) -> SecretString {
        self.secret
    }
}

impl fmt::Debug for OpaqueToken {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("OpaqueToken")
            .field("secret", &"[redacted]")
            .field("digest", &"[redacted]")
            .finish()
    }
}

pub struct SessionCredentials {
    session: OpaqueToken,
    csrf: OpaqueToken,
}

impl SessionCredentials {
    pub fn generate() -> Result<Self, TokenGenerationError> {
        Ok(Self {
            session: OpaqueToken::generate()?,
            csrf: OpaqueToken::generate()?,
        })
    }

    pub fn session_token(&self) -> &SecretString {
        self.session.secret()
    }

    pub fn session_digest(&self) -> TokenDigest {
        self.session.digest()
    }

    pub fn csrf_token(&self) -> &SecretString {
        self.csrf.secret()
    }

    pub fn csrf_digest(&self) -> TokenDigest {
        self.csrf.digest()
    }
}

impl fmt::Debug for SessionCredentials {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("SessionCredentials")
            .field("session_token", &"[redacted]")
            .field("session_digest", &"[redacted]")
            .field("csrf_token", &"[redacted]")
            .field("csrf_digest", &"[redacted]")
            .finish()
    }
}

#[derive(Debug, Error, Clone, Copy, PartialEq, Eq)]
#[error("operating system randomness is unavailable")]
pub struct TokenGenerationError;

pub fn digest_token(token: &str) -> TokenDigest {
    TokenDigest(Sha256::digest(token.as_bytes()).into())
}

pub fn verify_token_digest(token: &str, expected: TokenDigest) -> bool {
    bool::from(digest_token(token).as_bytes().ct_eq(expected.as_bytes()))
}

pub fn digest_valid_opaque_token(token: &str) -> Option<TokenDigest> {
    if token.len() != 43 {
        return None;
    }
    let decoded = URL_SAFE_NO_PAD.decode(token).ok()?;
    (decoded.len() == TOKEN_BYTES).then(|| digest_token(token))
}

fn generate_opaque_token() -> Result<SecretString, TokenGenerationError> {
    let mut bytes = [0_u8; TOKEN_BYTES];
    getrandom::fill(&mut bytes).map_err(|_| TokenGenerationError)?;
    Ok(SecretString::from(URL_SAFE_NO_PAD.encode(bytes)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_and_validates_email_addresses() {
        let email = NormalizedEmail::parse("  Owner@Example.COM ").unwrap();
        assert_eq!(email.as_str(), "owner@example.com");
        assert_eq!(format!("{email:?}"), "NormalizedEmail([redacted])");
        assert_eq!(
            NormalizedEmail::parse("not-an-email"),
            Err(IdentityValidationError::InvalidEmail),
        );
    }

    #[test]
    fn normalizes_and_validates_display_names() {
        let name = DisplayName::parse("  ZipShip Owner  ").unwrap();
        assert_eq!(name.as_str(), "ZipShip Owner");
        assert_eq!(
            DisplayName::parse("line\nbreak"),
            Err(IdentityValidationError::InvalidDisplayName),
        );
    }

    #[test]
    fn enforces_password_length_before_hashing() {
        assert_eq!(
            validate_password("too-short"),
            Err(IdentityValidationError::InvalidPassword),
        );
        assert!(validate_password("correct horse battery staple").is_ok());
        assert_eq!(
            validate_password(&"x".repeat(PASSWORD_MAX_BYTES + 1)),
            Err(IdentityValidationError::InvalidPassword),
        );
    }

    #[test]
    fn hashes_passwords_with_argon2id_and_unique_salts() {
        let engine = PasswordEngine::default();
        let password = SecretString::from("correct horse battery staple".to_owned());
        let first = engine.hash(&password).unwrap();
        let second = engine.hash(&password).unwrap();

        assert!(
            first
                .as_str()
                .starts_with("$argon2id$v=19$m=19456,t=2,p=1$")
        );
        assert_ne!(first.as_str(), second.as_str());
        assert!(engine.verify(&password, &first).unwrap());
        assert!(
            !engine
                .verify(
                    &SecretString::from("this is the wrong password".to_owned()),
                    &first,
                )
                .unwrap(),
        );
        assert_eq!(format!("{first:?}"), "EncodedPasswordHash([redacted])");
    }

    #[test]
    fn generates_independent_session_and_csrf_secrets() {
        let credentials = SessionCredentials::generate().unwrap();
        assert_eq!(credentials.session_token().expose_secret().len(), 43);
        assert_eq!(credentials.csrf_token().expose_secret().len(), 43);
        assert_ne!(
            credentials.session_token().expose_secret(),
            credentials.csrf_token().expose_secret(),
        );
        assert!(verify_token_digest(
            credentials.session_token().expose_secret(),
            credentials.session_digest(),
        ));
        assert!(verify_token_digest(
            credentials.csrf_token().expose_secret(),
            credentials.csrf_digest(),
        ));
        assert!(!format!("{credentials:?}").contains(credentials.session_token().expose_secret()));
    }

    #[test]
    fn generates_reusable_redacted_opaque_tokens() {
        let token = OpaqueToken::generate().unwrap();
        let secret = token.secret().expose_secret();

        assert_eq!(secret.len(), 43);
        assert_eq!(digest_valid_opaque_token(secret), Some(token.digest()));
        assert!(digest_valid_opaque_token("not-a-token").is_none());
        assert!(!format!("{token:?}").contains(secret));
    }
}
