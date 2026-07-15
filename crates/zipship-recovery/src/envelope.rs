use crate::constants::ENVELOPE_PURPOSE;
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use chacha20poly1305::{
    XChaCha20Poly1305, XNonce,
    aead::{Aead, KeyInit, Payload},
};
use secrecy::{ExposeSecret, SecretBox, SecretString};
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, fmt, sync::Arc};
use thiserror::Error;
use uuid::Uuid;
use zeroize::Zeroize;
use zipship_auth::{NormalizedEmail, digest_valid_opaque_token};

#[derive(Clone, PartialEq, Eq)]
pub struct SealedEnvelope {
    pub key_id: String,
    pub nonce: [u8; 24],
    pub ciphertext: Vec<u8>,
}

impl fmt::Debug for SealedEnvelope {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("SealedEnvelope")
            .field("key_id", &self.key_id)
            .field("nonce", &"[redacted]")
            .field("ciphertext", &"[redacted]")
            .finish()
    }
}

#[derive(Debug)]
pub struct PasswordResetDelivery {
    pub recipient: NormalizedEmail,
    pub token: SecretString,
}

#[derive(Debug, Error, Clone, Copy, PartialEq, Eq)]
pub enum EnvelopeError {
    #[error("envelope key id is invalid")]
    InvalidKeyId,
    #[error("envelope key id is duplicated")]
    DuplicateKeyId,
    #[error("active envelope key is missing")]
    ActiveKeyMissing,
    #[error("envelope encryption failed")]
    EncryptionFailed,
    #[error("envelope cannot be decrypted")]
    DecryptionFailed,
}

#[derive(Clone)]
pub struct EnvelopeKeyRing {
    active_key_id: Arc<str>,
    keys: Arc<BTreeMap<String, Arc<SecretBox<[u8; 32]>>>>,
}

impl fmt::Debug for EnvelopeKeyRing {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("EnvelopeKeyRing")
            .field("active_key_id", &self.active_key_id)
            .field("key_count", &self.keys.len())
            .finish_non_exhaustive()
    }
}

impl EnvelopeKeyRing {
    pub fn active_key_id(&self) -> &str {
        &self.active_key_id
    }

    pub fn key_count(&self) -> usize {
        self.keys.len()
    }

    pub fn from_base64_config(
        active_key_id: impl Into<String>,
        encoded_keys: &SecretString,
    ) -> Result<Self, EnvelopeError> {
        let mut keys = Vec::new();
        for entry in encoded_keys.expose_secret().split(',') {
            let (key_id, encoded_key) = entry.split_once(':').ok_or(EnvelopeError::InvalidKeyId)?;
            let mut decoded = URL_SAFE_NO_PAD
                .decode(encoded_key)
                .map_err(|_| EnvelopeError::EncryptionFailed)?;
            let key: Result<[u8; 32], _> = decoded
                .as_slice()
                .try_into()
                .map_err(|_| EnvelopeError::EncryptionFailed);
            decoded.zeroize();
            keys.push((key_id.to_owned(), SecretBox::new(Box::new(key?))));
        }
        Self::new(active_key_id, keys)
    }

    pub fn new(
        active_key_id: impl Into<String>,
        keys: Vec<(String, SecretBox<[u8; 32]>)>,
    ) -> Result<Self, EnvelopeError> {
        let active_key_id = active_key_id.into();
        validate_key_id(&active_key_id)?;
        let mut indexed = BTreeMap::new();
        for (key_id, key) in keys {
            validate_key_id(&key_id)?;
            if indexed.insert(key_id, Arc::new(key)).is_some() {
                return Err(EnvelopeError::DuplicateKeyId);
            }
        }
        if !indexed.contains_key(&active_key_id) {
            return Err(EnvelopeError::ActiveKeyMissing);
        }
        Ok(Self {
            active_key_id: Arc::from(active_key_id),
            keys: Arc::new(indexed),
        })
    }

    pub fn seal_password_reset(
        &self,
        request_id: Uuid,
        recipient: &NormalizedEmail,
        token: &SecretString,
    ) -> Result<SealedEnvelope, EnvelopeError> {
        if digest_valid_opaque_token(token.expose_secret()).is_none() {
            return Err(EnvelopeError::EncryptionFailed);
        }
        let key = self
            .keys
            .get(self.active_key_id.as_ref())
            .ok_or(EnvelopeError::ActiveKeyMissing)?;
        let payload = DeliveryPayloadRef {
            recipient: recipient.as_str(),
            token: token.expose_secret(),
        };
        let mut plaintext =
            serde_json::to_vec(&payload).map_err(|_| EnvelopeError::EncryptionFailed)?;
        let mut nonce = [0_u8; 24];
        if getrandom::fill(&mut nonce).is_err() {
            plaintext.zeroize();
            return Err(EnvelopeError::EncryptionFailed);
        }
        let cipher = XChaCha20Poly1305::new_from_slice(key.expose_secret())
            .map_err(|_| EnvelopeError::EncryptionFailed)?;
        let aad = envelope_aad(request_id);
        let nonce_value = XNonce::from(nonce);
        let encrypted = cipher.encrypt(
            &nonce_value,
            Payload {
                msg: &plaintext,
                aad: &aad,
            },
        );
        plaintext.zeroize();
        Ok(SealedEnvelope {
            key_id: self.active_key_id.to_string(),
            nonce,
            ciphertext: encrypted.map_err(|_| EnvelopeError::EncryptionFailed)?,
        })
    }

    pub fn open_password_reset(
        &self,
        request_id: Uuid,
        envelope: &SealedEnvelope,
    ) -> Result<PasswordResetDelivery, EnvelopeError> {
        let key = self
            .keys
            .get(&envelope.key_id)
            .ok_or(EnvelopeError::DecryptionFailed)?;
        let cipher = XChaCha20Poly1305::new_from_slice(key.expose_secret())
            .map_err(|_| EnvelopeError::DecryptionFailed)?;
        let aad = envelope_aad(request_id);
        let nonce = XNonce::from(envelope.nonce);
        let mut plaintext = cipher
            .decrypt(
                &nonce,
                Payload {
                    msg: &envelope.ciphertext,
                    aad: &aad,
                },
            )
            .map_err(|_| EnvelopeError::DecryptionFailed)?;
        let payload = serde_json::from_slice::<DeliveryPayload>(&plaintext)
            .map_err(|_| EnvelopeError::DecryptionFailed);
        plaintext.zeroize();
        let payload = payload?;
        let recipient = NormalizedEmail::parse(&payload.recipient)
            .map_err(|_| EnvelopeError::DecryptionFailed)?;
        if digest_valid_opaque_token(&payload.token).is_none() {
            return Err(EnvelopeError::DecryptionFailed);
        }
        Ok(PasswordResetDelivery {
            recipient,
            token: SecretString::from(payload.token),
        })
    }
}

#[derive(Serialize)]
struct DeliveryPayloadRef<'a> {
    recipient: &'a str,
    token: &'a str,
}

#[derive(Deserialize)]
struct DeliveryPayload {
    recipient: String,
    token: String,
}

fn validate_key_id(key_id: &str) -> Result<(), EnvelopeError> {
    if key_id.is_empty()
        || key_id.len() > 64
        || !key_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
    {
        return Err(EnvelopeError::InvalidKeyId);
    }
    Ok(())
}

fn envelope_aad(request_id: Uuid) -> Vec<u8> {
    let mut aad = Vec::with_capacity(ENVELOPE_PURPOSE.len() + 16);
    aad.extend_from_slice(ENVELOPE_PURPOSE);
    aad.extend_from_slice(request_id.as_bytes());
    aad
}
