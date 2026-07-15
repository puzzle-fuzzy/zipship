use super::row::{ResolvedSessionRow, UserRow};
use super::*;
use secrecy::SecretString;
use zipship_auth::PasswordEngine;

fn valid_user_row() -> UserRow {
    let password_hash = PasswordEngine::default()
        .hash(&SecretString::from(
            "correct horse battery staple".to_owned(),
        ))
        .unwrap();
    UserRow {
        id: Uuid::new_v4(),
        email: "owner@example.com".to_owned(),
        display_name: "Owner".to_owned(),
        password_hash: password_hash.as_str().to_owned(),
        disabled_at: None,
    }
}

#[test]
fn decodes_valid_user_rows() {
    let user = StoredUser::try_from(valid_user_row()).unwrap();
    assert_eq!(user.email.as_str(), "owner@example.com");
    assert_eq!(user.display_name.as_str(), "Owner");
}

#[test]
fn rejects_corrupt_session_digests() {
    let user = valid_user_row();
    let row = ResolvedSessionRow {
        session_id: Uuid::new_v4(),
        csrf_secret_hash: vec![0; 31],
        user_id: user.id,
        email: user.email,
        display_name: user.display_name,
        password_hash: user.password_hash,
        disabled_at: user.disabled_at,
    };
    assert!(ResolvedSession::try_from(row).is_err());
}
