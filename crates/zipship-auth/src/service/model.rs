use crate::{DisplayName, EncodedPasswordHash, NormalizedEmail, SessionCredentials, TokenDigest};
use secrecy::SecretString;
use time::OffsetDateTime;
use uuid::Uuid;
use zipship_domain::{OrganizationName, OrganizationSlug};

#[derive(Debug)]
pub struct RegisterCommand {
    pub email: String,
    pub display_name: String,
    pub password: SecretString,
}

#[derive(Debug)]
pub struct LoginCommand {
    pub email: String,
    pub password: SecretString,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UserProfile {
    pub id: Uuid,
    pub email: String,
    pub display_name: String,
}

#[derive(Debug)]
pub struct AuthOutcome {
    pub user: UserProfile,
    pub session_id: Uuid,
    pub credentials: SessionCredentials,
    pub expires_at: OffsetDateTime,
}

#[derive(Debug, Clone)]
pub struct NewUser {
    pub id: Uuid,
    pub email: NormalizedEmail,
    pub display_name: DisplayName,
    pub password_hash: EncodedPasswordHash,
    pub created_at: OffsetDateTime,
}

#[derive(Debug, Clone)]
pub struct NewSession {
    pub id: Uuid,
    pub user_id: Uuid,
    pub token_digest: TokenDigest,
    pub csrf_digest: TokenDigest,
    pub expires_at: OffsetDateTime,
    pub created_at: OffsetDateTime,
}

#[derive(Debug, Clone)]
pub struct NewPersonalOrganization {
    pub id: Uuid,
    pub name: OrganizationName,
    pub slug: OrganizationSlug,
    pub created_at: OffsetDateTime,
}

#[derive(Debug, Clone)]
pub struct StoredUser {
    pub id: Uuid,
    pub email: NormalizedEmail,
    pub display_name: DisplayName,
    pub password_hash: EncodedPasswordHash,
    pub disabled_at: Option<OffsetDateTime>,
}

#[derive(Debug, Clone)]
pub struct ResolvedSession {
    pub session_id: Uuid,
    pub user: StoredUser,
    pub csrf_digest: TokenDigest,
}

impl ResolvedSession {
    pub fn profile(&self) -> UserProfile {
        profile_from_stored_user(&self.user)
    }
}

pub(super) fn profile_from_new_user(user: &NewUser) -> UserProfile {
    UserProfile {
        id: user.id,
        email: user.email.as_str().to_owned(),
        display_name: user.display_name.as_str().to_owned(),
    }
}

pub(super) fn profile_from_stored_user(user: &StoredUser) -> UserProfile {
    UserProfile {
        id: user.id,
        email: user.email.as_str().to_owned(),
        display_name: user.display_name.as_str().to_owned(),
    }
}
