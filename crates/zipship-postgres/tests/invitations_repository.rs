use secrecy::{ExposeSecret, SecretString};
use sqlx::{PgPool, postgres::PgPoolOptions};
use std::sync::{Arc, Mutex};
use time::{Duration, OffsetDateTime};
use uuid::Uuid;
use zipship_auth::{AuthService, RegisterCommand};
use zipship_invitations::{
    AcceptInvitationCommand, Clock, CreateInvitationCommand, InvitationState, InvitationsError,
    InvitationsService, RevokeInvitationCommand,
};
use zipship_postgres::{PgAuthRepository, PgInvitationsRepository, PgProjectsRepository};
use zipship_projects::ProjectsService;

const NOW: OffsetDateTime = OffsetDateTime::UNIX_EPOCH;

#[tokio::test]
#[ignore = "requires an isolated PostgreSQL database"]
async fn enforces_the_complete_invitation_lifecycle_atomically() {
    let pool = test_pool().await;
    zipship_postgres::migrate(&pool).await.unwrap();
    sqlx::query("TRUNCATE TABLE organizations, users CASCADE")
        .execute(&pool)
        .await
        .unwrap();

    let auth = AuthService::new(Arc::new(PgAuthRepository::new(pool.clone())))
        .await
        .unwrap();
    let owner = register(&auth, "owner@example.com", "Owner").await;
    let administrator = register(&auth, "admin@example.com", "Administrator").await;
    let existing = register(&auth, "existing@example.com", "Existing").await;
    let invitee = register(&auth, "invitee@example.com", "Invitee").await;
    let wrong_user = register(&auth, "wrong@example.com", "Wrong User").await;
    let racer = register(&auth, "racer@example.com", "Racer").await;
    let expiring = register(&auth, "expiring@example.com", "Expiring").await;
    let owner_id = owner.user.id;
    let administrator_id = administrator.user.id;
    let existing_id = existing.user.id;
    let invitee_id = invitee.user.id;
    let wrong_user_id = wrong_user.user.id;
    let racer_id = racer.user.id;
    let expiring_id = expiring.user.id;
    let projects = ProjectsService::new(Arc::new(PgProjectsRepository::new(pool.clone())));
    let organization_id = projects.list_organizations(owner_id).await.unwrap()[0].id;
    sqlx::query(
        r#"
        INSERT INTO memberships (organization_id, user_id, role)
        VALUES ($1, $2, 'admin'), ($1, $3, 'viewer')
        "#,
    )
    .bind(organization_id)
    .bind(administrator_id)
    .bind(existing_id)
    .execute(&pool)
    .await
    .unwrap();

    let clock = Arc::new(MutableClock::new(NOW));
    let repository = Arc::new(PgInvitationsRepository::new(pool.clone()));
    let invitations =
        InvitationsService::with_clock_and_ttl(repository, clock.clone(), Duration::hours(1));

    assert_eq!(
        invitations
            .create(create_command(
                organization_id,
                administrator_id,
                "blocked-owner@example.com",
                "owner",
            ))
            .await
            .unwrap_err(),
        InvitationsError::Forbidden
    );
    assert_eq!(
        invitations
            .create(create_command(
                organization_id,
                owner_id,
                "existing@example.com",
                "viewer",
            ))
            .await
            .unwrap_err(),
        InvitationsError::AlreadyMember
    );

    let create_a = invitations.create(create_command(
        organization_id,
        owner_id,
        " New.User@Example.COM ",
        "viewer",
    ));
    let create_b = invitations.create(create_command(
        organization_id,
        owner_id,
        "new.user@example.com",
        "developer",
    ));
    let (first, second) = tokio::join!(create_a, create_b);
    assert!(matches!(
        (&first, &second),
        (Ok(_), Err(InvitationsError::Pending)) | (Err(InvitationsError::Pending), Ok(_))
    ));
    let issued_once = first.ok().or_else(|| second.ok()).unwrap();
    let stored_hash: Vec<u8> =
        sqlx::query_scalar("SELECT token_hash FROM invitations WHERE id = $1")
            .bind(issued_once.invitation.id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(stored_hash.len(), 32);
    assert_ne!(
        stored_hash,
        issued_once.accept_token.expose_secret().as_bytes()
    );

    let owner_invitation = invitations
        .create(create_command(
            organization_id,
            owner_id,
            "invitee@example.com",
            "owner",
        ))
        .await
        .unwrap();
    let owner_view = invitations.list(owner_id, organization_id).await.unwrap();
    let administrator_view = invitations
        .list(administrator_id, organization_id)
        .await
        .unwrap();
    assert!(
        owner_view
            .iter()
            .any(|invitation| invitation.id == owner_invitation.invitation.id)
    );
    assert!(
        administrator_view
            .iter()
            .all(|invitation| invitation.role != zipship_domain::MemberRole::Owner)
    );
    assert_eq!(
        invitations
            .revoke(RevokeInvitationCommand {
                organization_id,
                actor_id: administrator_id,
                invitation_id: owner_invitation.invitation.id,
            })
            .await,
        Err(InvitationsError::Forbidden)
    );
    assert_eq!(
        invitations
            .accept(accept_command(
                wrong_user_id,
                "wrong@example.com",
                owner_invitation.accept_token.expose_secret(),
            ))
            .await,
        Err(InvitationsError::WrongRecipient)
    );
    let accepted = invitations
        .accept(accept_command(
            invitee_id,
            "invitee@example.com",
            owner_invitation.accept_token.expose_secret(),
        ))
        .await
        .unwrap();
    assert!(!accepted.replayed);
    assert_eq!(accepted.role, zipship_domain::MemberRole::Owner);
    let replayed = invitations
        .accept(accept_command(
            invitee_id,
            "invitee@example.com",
            owner_invitation.accept_token.expose_secret(),
        ))
        .await
        .unwrap();
    assert!(replayed.replayed);
    assert_eq!(
        membership_count(&pool, organization_id, invitee_id).await,
        1
    );
    assert_eq!(
        audit_count(&pool, organization_id, "member.joined", invitee_id).await,
        1
    );

    let racing_invitation = invitations
        .create(create_command(
            organization_id,
            owner_id,
            "racer@example.com",
            "developer",
        ))
        .await
        .unwrap();
    let revoke = invitations.revoke(RevokeInvitationCommand {
        organization_id,
        actor_id: owner_id,
        invitation_id: racing_invitation.invitation.id,
    });
    let accept = invitations.accept(accept_command(
        racer_id,
        "racer@example.com",
        racing_invitation.accept_token.expose_secret(),
    ));
    let (revoked, accepted) = tokio::join!(revoke, accept);
    assert!(matches!(
        (revoked, accepted),
        (Ok(()), Err(InvitationsError::NotFound)) | (Err(InvitationsError::NotFound), Ok(_))
    ));
    let racing_state: String = sqlx::query_scalar("SELECT state FROM invitations WHERE id = $1")
        .bind(racing_invitation.invitation.id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert!(matches!(racing_state.as_str(), "accepted" | "revoked"));
    assert_eq!(
        membership_count(&pool, organization_id, racer_id).await,
        i64::from(racing_state == "accepted")
    );

    let expiring_invitation = invitations
        .create(create_command(
            organization_id,
            owner_id,
            "expiring@example.com",
            "viewer",
        ))
        .await
        .unwrap();
    clock.set(NOW + Duration::hours(2));
    let active_after_expiration = invitations.list(owner_id, organization_id).await.unwrap();
    assert!(
        active_after_expiration
            .iter()
            .all(|invitation| invitation.id != expiring_invitation.invitation.id)
    );
    assert_eq!(
        invitations
            .accept(accept_command(
                expiring_id,
                "expiring@example.com",
                expiring_invitation.accept_token.expose_secret(),
            ))
            .await,
        Err(InvitationsError::Expired)
    );
    let expired_state: String = sqlx::query_scalar("SELECT state FROM invitations WHERE id = $1")
        .bind(expiring_invitation.invitation.id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(expired_state, InvitationState::Expired.as_str());
    let renewed = invitations
        .create(create_command(
            organization_id,
            owner_id,
            "expiring@example.com",
            "deployer",
        ))
        .await
        .unwrap();
    assert_ne!(renewed.invitation.id, expiring_invitation.invitation.id);

    let bad_digest = sqlx::query(
        r#"
        INSERT INTO invitations (
            id, organization_id, email, role, token_hash, invited_by, created_at, expires_at
        )
        VALUES ($1, $2, 'invalid@example.com', 'viewer', $3, $4, $5, $6)
        "#,
    )
    .bind(Uuid::new_v4())
    .bind(organization_id)
    .bind([1_u8].as_slice())
    .bind(owner_id)
    .bind(clock.now())
    .bind(clock.now() + Duration::hours(1))
    .execute(&pool)
    .await;
    assert!(bad_digest.is_err());
}

struct MutableClock {
    now: Mutex<OffsetDateTime>,
}

impl MutableClock {
    fn new(now: OffsetDateTime) -> Self {
        Self {
            now: Mutex::new(now),
        }
    }

    fn set(&self, now: OffsetDateTime) {
        *self.now.lock().unwrap() = now;
    }
}

impl Clock for MutableClock {
    fn now(&self) -> OffsetDateTime {
        *self.now.lock().unwrap()
    }
}

async fn register(
    auth: &AuthService,
    email: &str,
    display_name: &str,
) -> zipship_auth::AuthOutcome {
    auth.register(RegisterCommand {
        email: email.to_owned(),
        display_name: display_name.to_owned(),
        password: SecretString::from("correct horse battery staple".to_owned()),
    })
    .await
    .unwrap()
}

fn create_command(
    organization_id: Uuid,
    actor_id: Uuid,
    email: &str,
    role: &str,
) -> CreateInvitationCommand {
    CreateInvitationCommand {
        organization_id,
        actor_id,
        email: email.to_owned(),
        role: role.to_owned(),
    }
}

fn accept_command(actor_id: Uuid, actor_email: &str, token: &str) -> AcceptInvitationCommand {
    AcceptInvitationCommand {
        actor_id,
        actor_email: actor_email.to_owned(),
        token: token.to_owned(),
    }
}

async fn membership_count(pool: &PgPool, organization_id: Uuid, user_id: Uuid) -> i64 {
    sqlx::query_scalar(
        "SELECT count(*) FROM memberships WHERE organization_id = $1 AND user_id = $2",
    )
    .bind(organization_id)
    .bind(user_id)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn audit_count(pool: &PgPool, organization_id: Uuid, action: &str, target_id: Uuid) -> i64 {
    sqlx::query_scalar(
        r#"
        SELECT count(*)
        FROM audit_logs
        WHERE organization_id = $1 AND action = $2 AND target_id = $3
        "#,
    )
    .bind(organization_id)
    .bind(action)
    .bind(target_id)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn test_pool() -> PgPool {
    let database_url = std::env::var("ZIPSHIP_TEST_DATABASE_URL")
        .expect("ZIPSHIP_TEST_DATABASE_URL is required for the PostgreSQL integration test");
    PgPoolOptions::new()
        .max_connections(8)
        .connect(&database_url)
        .await
        .unwrap()
}
