use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use secrecy::{ExposeSecret, SecretString};
use sha2::{Digest, Sha256};
use std::fmt;
use subtle::ConstantTimeEq;
use thiserror::Error;

const TOKEN_BYTES: usize = 32;

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
