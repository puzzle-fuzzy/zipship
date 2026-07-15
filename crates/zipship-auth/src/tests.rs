use super::*;
use secrecy::{ExposeSecret, SecretString};

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
        validate_password(&"x".repeat(crate::identity::PASSWORD_MAX_BYTES + 1)),
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
