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
