#![forbid(unsafe_code)]

use async_trait::async_trait;
use secrecy::SecretString;
use std::{error::Error as StdError, str::FromStr, sync::Arc};
use thiserror::Error;
use time::{Duration, OffsetDateTime};
use uuid::Uuid;
use zipship_auth::{NormalizedEmail, OpaqueToken, TokenDigest, digest_valid_opaque_token};
use zipship_domain::{MemberRole, PermissionAction};

const DEFAULT_INVITATION_TTL: Duration = Duration::days(7);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InvitationState {
    Pending,
    Accepted,
    Revoked,
    Expired,
}

impl InvitationState {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Accepted => "accepted",
            Self::Revoked => "revoked",
            Self::Expired => "expired",
        }
    }
}

impl FromStr for InvitationState {
    type Err = InvitationsError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "pending" => Ok(Self::Pending),
            "accepted" => Ok(Self::Accepted),
            "revoked" => Ok(Self::Revoked),
            "expired" => Ok(Self::Expired),
            _ => Err(InvitationsError::Infrastructure),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Invitation {
    pub id: Uuid,
    pub organization_id: Uuid,
    pub email: String,
    pub role: MemberRole,
    pub state: InvitationState,
    pub invited_by: Option<Uuid>,
    pub accepted_by: Option<Uuid>,
    pub created_at: OffsetDateTime,
    pub expires_at: OffsetDateTime,
    pub resolved_at: Option<OffsetDateTime>,
}

#[derive(Debug, Clone)]
pub struct NewInvitation {
    pub id: Uuid,
    pub organization_id: Uuid,
    pub email: NormalizedEmail,
    pub role: MemberRole,
    pub invited_by: Uuid,
    pub token_digest: TokenDigest,
    pub created_at: OffsetDateTime,
    pub expires_at: OffsetDateTime,
}

#[derive(Debug)]
pub struct IssuedInvitation {
    pub invitation: Invitation,
    pub accept_token: SecretString,
}

#[derive(Debug)]
pub struct CreateInvitationCommand {
    pub organization_id: Uuid,
    pub actor_id: Uuid,
    pub email: String,
    pub role: String,
}

#[derive(Debug)]
pub struct ListInvitations {
    pub organization_id: Uuid,
    pub actor_id: Uuid,
    pub now: OffsetDateTime,
}

#[derive(Debug)]
pub struct RevokeInvitation {
    pub organization_id: Uuid,
    pub actor_id: Uuid,
    pub invitation_id: Uuid,
    pub revoked_at: OffsetDateTime,
}

#[derive(Debug)]
pub struct RevokeInvitationCommand {
    pub organization_id: Uuid,
    pub actor_id: Uuid,
    pub invitation_id: Uuid,
}

#[derive(Debug)]
pub struct AcceptInvitation {
    pub actor_id: Uuid,
    pub actor_email: NormalizedEmail,
    pub token_digest: TokenDigest,
    pub accepted_at: OffsetDateTime,
}

#[derive(Debug)]
pub struct AcceptInvitationCommand {
    pub actor_id: Uuid,
    pub actor_email: String,
    pub token: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AcceptedInvitation {
    pub invitation_id: Uuid,
    pub organization_id: Uuid,
    pub user_id: Uuid,
    pub role: MemberRole,
    pub replayed: bool,
}

#[derive(Debug, Error, Clone, Copy, PartialEq, Eq)]
pub enum InvitationPolicyError {
    #[error("the actor cannot manage this invitation role")]
    Forbidden,
}

pub fn validate_invitation_management(
    actor_role: MemberRole,
    invitation_role: MemberRole,
) -> Result<(), InvitationPolicyError> {
    if !actor_role.can(PermissionAction::InviteMember)
        || (actor_role != MemberRole::Owner && invitation_role == MemberRole::Owner)
    {
        return Err(InvitationPolicyError::Forbidden);
    }
    Ok(())
}

#[derive(Debug, Error)]
pub enum InvitationsRepositoryError {
    #[error("operation is forbidden")]
    Forbidden,
    #[error("the email already belongs to an organization member")]
    AlreadyMember,
    #[error("an active invitation already exists")]
    Pending,
    #[error("invitation was not found")]
    NotFound,
    #[error("invitation has expired")]
    Expired,
    #[error("invitation belongs to another email address")]
    WrongRecipient,
    #[error("invitations repository is unavailable")]
    Unavailable {
        #[source]
        source: Box<dyn StdError + Send + Sync>,
    },
}

impl InvitationsRepositoryError {
    pub fn unavailable(source: impl StdError + Send + Sync + 'static) -> Self {
        Self::Unavailable {
            source: Box::new(source),
        }
    }
}

#[async_trait]
pub trait InvitationsRepository: Send + Sync + 'static {
    async fn create_invitation(
        &self,
        invitation: NewInvitation,
    ) -> Result<Invitation, InvitationsRepositoryError>;

    async fn list_invitations(
        &self,
        request: ListInvitations,
    ) -> Result<Vec<Invitation>, InvitationsRepositoryError>;

    async fn revoke_invitation(
        &self,
        request: RevokeInvitation,
    ) -> Result<(), InvitationsRepositoryError>;

    async fn accept_invitation(
        &self,
        request: AcceptInvitation,
    ) -> Result<AcceptedInvitation, InvitationsRepositoryError>;
}

pub trait Clock: Send + Sync + 'static {
    fn now(&self) -> OffsetDateTime;
}

#[derive(Debug, Default)]
pub struct SystemClock;

impl Clock for SystemClock {
    fn now(&self) -> OffsetDateTime {
        OffsetDateTime::now_utc()
    }
}

#[derive(Debug, Error, Clone, Copy, PartialEq, Eq)]
pub enum InvitationsError {
    #[error("invitation email is invalid")]
    InvalidEmail,
    #[error("invitation role is invalid")]
    InvalidRole,
    #[error("operation is forbidden")]
    Forbidden,
    #[error("the email already belongs to an organization member")]
    AlreadyMember,
    #[error("an active invitation already exists")]
    Pending,
    #[error("invitation was not found")]
    NotFound,
    #[error("invitation has expired")]
    Expired,
    #[error("invitation belongs to another email address")]
    WrongRecipient,
    #[error("invitations infrastructure failed")]
    Infrastructure,
}

impl InvitationsError {
    pub const fn code(self) -> &'static str {
        match self {
            Self::InvalidEmail => "INVALID_EMAIL",
            Self::InvalidRole => "INVALID_MEMBER_ROLE",
            Self::Forbidden => "FORBIDDEN",
            Self::AlreadyMember => "ALREADY_MEMBER",
            Self::Pending => "INVITATION_PENDING",
            Self::NotFound => "INVITATION_NOT_FOUND",
            Self::Expired => "INVITATION_EXPIRED",
            Self::WrongRecipient => "INVITATION_WRONG_RECIPIENT",
            Self::Infrastructure => "INVITATIONS_INFRASTRUCTURE_FAILURE",
        }
    }
}

#[derive(Clone)]
pub struct InvitationsService {
    repository: Arc<dyn InvitationsRepository>,
    clock: Arc<dyn Clock>,
    ttl: Duration,
}

impl InvitationsService {
    pub fn new(repository: Arc<dyn InvitationsRepository>) -> Self {
        Self::with_clock_and_ttl(repository, Arc::new(SystemClock), DEFAULT_INVITATION_TTL)
    }

    pub fn with_clock_and_ttl(
        repository: Arc<dyn InvitationsRepository>,
        clock: Arc<dyn Clock>,
        ttl: Duration,
    ) -> Self {
        assert!(ttl.is_positive(), "invitation TTL must be positive");
        Self {
            repository,
            clock,
            ttl,
        }
    }

    pub async fn create(
        &self,
        command: CreateInvitationCommand,
    ) -> Result<IssuedInvitation, InvitationsError> {
        let email =
            NormalizedEmail::parse(&command.email).map_err(|_| InvitationsError::InvalidEmail)?;
        let role =
            MemberRole::from_str(&command.role).map_err(|_| InvitationsError::InvalidRole)?;
        let created_at = self.clock.now();
        let expires_at = created_at
            .checked_add(self.ttl)
            .ok_or(InvitationsError::Infrastructure)?;
        let token = OpaqueToken::generate().map_err(|_| InvitationsError::Infrastructure)?;
        let invitation = self
            .repository
            .create_invitation(NewInvitation {
                id: Uuid::new_v4(),
                organization_id: command.organization_id,
                email,
                role,
                invited_by: command.actor_id,
                token_digest: token.digest(),
                created_at,
                expires_at,
            })
            .await
            .map_err(map_repository_error)?;
        Ok(IssuedInvitation {
            invitation,
            accept_token: token.into_secret(),
        })
    }

    pub async fn list(
        &self,
        actor_id: Uuid,
        organization_id: Uuid,
    ) -> Result<Vec<Invitation>, InvitationsError> {
        self.repository
            .list_invitations(ListInvitations {
                organization_id,
                actor_id,
                now: self.clock.now(),
            })
            .await
            .map_err(map_repository_error)
    }

    pub async fn revoke(&self, command: RevokeInvitationCommand) -> Result<(), InvitationsError> {
        self.repository
            .revoke_invitation(RevokeInvitation {
                organization_id: command.organization_id,
                actor_id: command.actor_id,
                invitation_id: command.invitation_id,
                revoked_at: self.clock.now(),
            })
            .await
            .map_err(map_repository_error)
    }

    pub async fn accept(
        &self,
        command: AcceptInvitationCommand,
    ) -> Result<AcceptedInvitation, InvitationsError> {
        let actor_email = NormalizedEmail::parse(&command.actor_email)
            .map_err(|_| InvitationsError::Infrastructure)?;
        let token_digest =
            digest_valid_opaque_token(&command.token).ok_or(InvitationsError::NotFound)?;
        self.repository
            .accept_invitation(AcceptInvitation {
                actor_id: command.actor_id,
                actor_email,
                token_digest,
                accepted_at: self.clock.now(),
            })
            .await
            .map_err(map_repository_error)
    }
}

fn map_repository_error(error: InvitationsRepositoryError) -> InvitationsError {
    match error {
        InvitationsRepositoryError::Forbidden => InvitationsError::Forbidden,
        InvitationsRepositoryError::AlreadyMember => InvitationsError::AlreadyMember,
        InvitationsRepositoryError::Pending => InvitationsError::Pending,
        InvitationsRepositoryError::NotFound => InvitationsError::NotFound,
        InvitationsRepositoryError::Expired => InvitationsError::Expired,
        InvitationsRepositoryError::WrongRecipient => InvitationsError::WrongRecipient,
        InvitationsRepositoryError::Unavailable { .. } => InvitationsError::Infrastructure,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use secrecy::ExposeSecret;
    use std::sync::Mutex;

    const NOW: OffsetDateTime = OffsetDateTime::UNIX_EPOCH;

    #[derive(Default)]
    struct TestRepository {
        creations: Mutex<Vec<NewInvitation>>,
        accepts: Mutex<Vec<AcceptInvitation>>,
    }

    #[async_trait]
    impl InvitationsRepository for TestRepository {
        async fn create_invitation(
            &self,
            invitation: NewInvitation,
        ) -> Result<Invitation, InvitationsRepositoryError> {
            let result = Invitation {
                id: invitation.id,
                organization_id: invitation.organization_id,
                email: invitation.email.as_str().to_owned(),
                role: invitation.role,
                state: InvitationState::Pending,
                invited_by: Some(invitation.invited_by),
                accepted_by: None,
                created_at: invitation.created_at,
                expires_at: invitation.expires_at,
                resolved_at: None,
            };
            self.creations.lock().unwrap().push(invitation);
            Ok(result)
        }

        async fn list_invitations(
            &self,
            _request: ListInvitations,
        ) -> Result<Vec<Invitation>, InvitationsRepositoryError> {
            Ok(Vec::new())
        }

        async fn revoke_invitation(
            &self,
            _request: RevokeInvitation,
        ) -> Result<(), InvitationsRepositoryError> {
            Ok(())
        }

        async fn accept_invitation(
            &self,
            request: AcceptInvitation,
        ) -> Result<AcceptedInvitation, InvitationsRepositoryError> {
            let result = AcceptedInvitation {
                invitation_id: Uuid::from_u128(1),
                organization_id: Uuid::from_u128(2),
                user_id: request.actor_id,
                role: MemberRole::Developer,
                replayed: false,
            };
            self.accepts.lock().unwrap().push(request);
            Ok(result)
        }
    }

    struct FixedClock;

    impl Clock for FixedClock {
        fn now(&self) -> OffsetDateTime {
            NOW
        }
    }

    #[test]
    fn enforces_invitation_role_boundaries() {
        assert!(validate_invitation_management(MemberRole::Owner, MemberRole::Owner).is_ok());
        assert!(validate_invitation_management(MemberRole::Admin, MemberRole::Admin).is_ok());
        assert_eq!(
            validate_invitation_management(MemberRole::Admin, MemberRole::Owner),
            Err(InvitationPolicyError::Forbidden)
        );
        assert_eq!(
            validate_invitation_management(MemberRole::Developer, MemberRole::Viewer),
            Err(InvitationPolicyError::Forbidden)
        );
    }

    #[tokio::test]
    async fn creates_normalized_typed_expiring_invitations() {
        let repository = Arc::new(TestRepository::default());
        let service = InvitationsService::with_clock_and_ttl(
            repository.clone(),
            Arc::new(FixedClock),
            Duration::hours(2),
        );
        let organization_id = Uuid::new_v4();
        let actor_id = Uuid::new_v4();

        let issued = service
            .create(CreateInvitationCommand {
                organization_id,
                actor_id,
                email: " New.Member@Example.COM ".to_owned(),
                role: "developer".to_owned(),
            })
            .await
            .unwrap();

        assert_eq!(issued.invitation.email, "new.member@example.com");
        assert_eq!(issued.invitation.role, MemberRole::Developer);
        assert_eq!(issued.invitation.expires_at, NOW + Duration::hours(2));
        let creations = repository.creations.lock().unwrap();
        assert_eq!(creations.len(), 1);
        assert_eq!(
            digest_valid_opaque_token(issued.accept_token.expose_secret()),
            Some(creations[0].token_digest)
        );
    }

    #[tokio::test]
    async fn rejects_invalid_create_inputs_before_repository_access() {
        let repository = Arc::new(TestRepository::default());
        let service = InvitationsService::with_clock_and_ttl(
            repository.clone(),
            Arc::new(FixedClock),
            Duration::days(7),
        );
        for (email, role, expected) in [
            ("not-email", "viewer", InvitationsError::InvalidEmail),
            (
                "member@example.com",
                "superuser",
                InvitationsError::InvalidRole,
            ),
        ] {
            let result = service
                .create(CreateInvitationCommand {
                    organization_id: Uuid::new_v4(),
                    actor_id: Uuid::new_v4(),
                    email: email.to_owned(),
                    role: role.to_owned(),
                })
                .await;
            assert_eq!(result.unwrap_err(), expected);
        }
        assert!(repository.creations.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn rejects_malformed_accept_tokens_before_repository_access() {
        let repository = Arc::new(TestRepository::default());
        let service = InvitationsService::with_clock_and_ttl(
            repository.clone(),
            Arc::new(FixedClock),
            Duration::days(7),
        );
        let error = service
            .accept(AcceptInvitationCommand {
                actor_id: Uuid::new_v4(),
                actor_email: "member@example.com".to_owned(),
                token: "not-a-token".to_owned(),
            })
            .await
            .unwrap_err();

        assert_eq!(error, InvitationsError::NotFound);
        assert!(repository.accepts.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn forwards_normalized_acceptance_commands() {
        let repository = Arc::new(TestRepository::default());
        let service = InvitationsService::with_clock_and_ttl(
            repository.clone(),
            Arc::new(FixedClock),
            Duration::days(7),
        );
        let token = OpaqueToken::generate().unwrap();
        let actor_id = Uuid::new_v4();

        let accepted = service
            .accept(AcceptInvitationCommand {
                actor_id,
                actor_email: " MEMBER@EXAMPLE.COM ".to_owned(),
                token: token.secret().expose_secret().to_owned(),
            })
            .await
            .unwrap();

        assert_eq!(accepted.user_id, actor_id);
        let accepts = repository.accepts.lock().unwrap();
        assert_eq!(accepts.len(), 1);
        assert_eq!(accepts[0].actor_email.as_str(), "member@example.com");
        assert_eq!(accepts[0].token_digest, token.digest());
        assert_eq!(accepts[0].accepted_at, NOW);
    }
}
