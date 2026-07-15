use secrecy::SecretString;
use sqlx::{PgPool, postgres::PgPoolOptions};
use std::sync::Arc;
use time::OffsetDateTime;
use uuid::Uuid;
use zipship_auth::{AuthService, RegisterCommand};
use zipship_domain::MemberRole;
use zipship_members::{MembersError, MembersService, RemoveMemberCommand, UpdateMemberRoleCommand};
use zipship_postgres::{PgAuthRepository, PgMembersRepository, PgProjectsRepository};
use zipship_projects::ProjectsService;

#[tokio::test]
#[ignore = "requires an isolated PostgreSQL database"]
async fn serializes_member_mutations_and_preserves_the_last_owner() {
    let pool = test_pool().await;
    zipship_postgres::migrate(&pool).await.unwrap();
    sqlx::query("TRUNCATE TABLE organizations, users CASCADE")
        .execute(&pool)
        .await
        .unwrap();

    let auth = AuthService::new(Arc::new(PgAuthRepository::new(pool.clone())))
        .await
        .unwrap();
    let owner = auth
        .register(register_command("owner@example.com", "Owner"))
        .await
        .unwrap();
    let member = auth
        .register(register_command("member@example.com", "Member"))
        .await
        .unwrap();
    let administrator = auth
        .register(register_command("admin@example.com", "Administrator"))
        .await
        .unwrap();
    let leaver = auth
        .register(register_command("leaver@example.com", "Leaver"))
        .await
        .unwrap();
    let managed = auth
        .register(register_command("managed@example.com", "Managed"))
        .await
        .unwrap();
    let owner_id = owner.user.id;
    let member_id = member.user.id;
    let administrator_id = administrator.user.id;
    let leaver_id = leaver.user.id;
    let managed_id = managed.user.id;
    let projects = ProjectsService::new(Arc::new(PgProjectsRepository::new(pool.clone())));
    let organization_id = projects.list_organizations(owner_id).await.unwrap()[0].id;
    sqlx::query(
        r#"
        INSERT INTO memberships (organization_id, user_id, role)
        VALUES
            ($1, $2, 'viewer'),
            ($1, $3, 'admin'),
            ($1, $4, 'viewer'),
            ($1, $5, 'developer')
        "#,
    )
    .bind(organization_id)
    .bind(member_id)
    .bind(administrator_id)
    .bind(leaver_id)
    .bind(managed_id)
    .execute(&pool)
    .await
    .unwrap();
    let members = MembersService::new(Arc::new(PgMembersRepository::new(pool.clone())));

    let visible = members
        .list_members(member_id, organization_id)
        .await
        .unwrap();
    assert_eq!(visible.len(), 5);
    assert_eq!(visible[0].user_id, owner_id);

    let administered = members
        .update_role(update_command(
            administrator_id,
            organization_id,
            member_id,
            "developer",
        ))
        .await
        .unwrap();
    assert_eq!(administered.role, MemberRole::Developer);
    assert_eq!(
        members
            .update_role(update_command(
                administrator_id,
                organization_id,
                member_id,
                "owner",
            ))
            .await,
        Err(MembersError::Forbidden)
    );
    let promoted = members
        .update_role(update_command(
            owner_id,
            organization_id,
            member_id,
            "owner",
        ))
        .await
        .unwrap();
    assert_eq!(promoted.role, MemberRole::Owner);
    let promoted_at: OffsetDateTime = sqlx::query_scalar(
        "SELECT updated_at FROM memberships WHERE organization_id = $1 AND user_id = $2",
    )
    .bind(organization_id)
    .bind(member_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    let promotion_audit_count = role_update_audit_count(&pool, organization_id).await;
    assert_eq!(promotion_audit_count, 2);
    let promotion_metadata: serde_json::Value = sqlx::query_scalar(
        r#"
        SELECT metadata
        FROM audit_logs
        WHERE organization_id = $1
          AND action = 'member.role_updated'
          AND metadata ->> 'role' = 'owner'
        "#,
    )
    .bind(organization_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        promotion_metadata,
        serde_json::json!({ "previousRole": "developer", "role": "owner" })
    );

    let unchanged = members
        .update_role(update_command(
            owner_id,
            organization_id,
            member_id,
            "owner",
        ))
        .await
        .unwrap();
    assert_eq!(unchanged, promoted);
    let unchanged_at: OffsetDateTime = sqlx::query_scalar(
        "SELECT updated_at FROM memberships WHERE organization_id = $1 AND user_id = $2",
    )
    .bind(organization_id)
    .bind(member_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(unchanged_at, promoted_at);
    assert_eq!(
        role_update_audit_count(&pool, organization_id).await,
        promotion_audit_count
    );
    assert_eq!(
        members
            .update_role(update_command(
                administrator_id,
                organization_id,
                member_id,
                "viewer",
            ))
            .await,
        Err(MembersError::Forbidden)
    );
    assert_eq!(
        members
            .update_role(update_command(
                owner_id,
                organization_id,
                Uuid::new_v4(),
                "viewer",
            ))
            .await,
        Err(MembersError::NotFound)
    );

    let demote_original_owner = members.update_role(update_command(
        owner_id,
        organization_id,
        owner_id,
        "viewer",
    ));
    let remove_promoted_owner =
        members.remove_member(remove_command(owner_id, organization_id, member_id));
    let (demotion, removal) = tokio::join!(demote_original_owner, remove_promoted_owner);
    assert!(matches!(
        (demotion, removal),
        (Ok(_), Err(MembersError::Forbidden)) | (Err(MembersError::LastOwner), Ok(()))
    ));
    let remaining_owner_id: Uuid = sqlx::query_scalar(
        "SELECT user_id FROM memberships WHERE organization_id = $1 AND role = 'owner'",
    )
    .bind(organization_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    let owner_count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM memberships WHERE organization_id = $1 AND role = 'owner'",
    )
    .bind(organization_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(owner_count, 1);
    assert_eq!(
        members
            .remove_member(remove_command(
                administrator_id,
                organization_id,
                remaining_owner_id,
            ))
            .await,
        Err(MembersError::Forbidden)
    );
    assert_eq!(
        members
            .update_role(update_command(
                remaining_owner_id,
                organization_id,
                remaining_owner_id,
                "admin",
            ))
            .await,
        Err(MembersError::LastOwner)
    );

    members
        .remove_member(remove_command(leaver_id, organization_id, leaver_id))
        .await
        .unwrap();
    assert!(!membership_exists(&pool, organization_id, leaver_id).await);
    assert_eq!(
        members
            .remove_member(remove_command(leaver_id, organization_id, leaver_id))
            .await,
        Err(MembersError::Forbidden)
    );

    members
        .remove_member(remove_command(
            administrator_id,
            organization_id,
            managed_id,
        ))
        .await
        .unwrap();
    assert!(!membership_exists(&pool, organization_id, managed_id).await);
    assert_eq!(
        members
            .remove_member(remove_command(
                administrator_id,
                organization_id,
                managed_id,
            ))
            .await,
        Err(MembersError::NotFound)
    );
    assert_eq!(
        removal_audit_metadata(&pool, organization_id, leaver_id).await,
        serde_json::json!({ "role": "viewer", "selfRemoval": true })
    );
    assert_eq!(
        removal_audit_metadata(&pool, organization_id, managed_id).await,
        serde_json::json!({ "role": "developer", "selfRemoval": false })
    );
    assert_eq!(member_mutation_audit_count(&pool, organization_id).await, 5);
}

async fn role_update_audit_count(pool: &PgPool, organization_id: Uuid) -> i64 {
    sqlx::query_scalar(
        "SELECT count(*) FROM audit_logs WHERE organization_id = $1 AND action = 'member.role_updated'",
    )
    .bind(organization_id)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn member_mutation_audit_count(pool: &PgPool, organization_id: Uuid) -> i64 {
    sqlx::query_scalar(
        r#"
        SELECT count(*)
        FROM audit_logs
        WHERE organization_id = $1
          AND action IN ('member.role_updated', 'member.removed')
        "#,
    )
    .bind(organization_id)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn membership_exists(pool: &PgPool, organization_id: Uuid, user_id: Uuid) -> bool {
    sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM memberships WHERE organization_id = $1 AND user_id = $2)",
    )
    .bind(organization_id)
    .bind(user_id)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn removal_audit_metadata(
    pool: &PgPool,
    organization_id: Uuid,
    target_user_id: Uuid,
) -> serde_json::Value {
    sqlx::query_scalar(
        r#"
        SELECT metadata
        FROM audit_logs
        WHERE organization_id = $1
          AND action = 'member.removed'
          AND target_id = $2
        "#,
    )
    .bind(organization_id)
    .bind(target_user_id)
    .fetch_one(pool)
    .await
    .unwrap()
}

fn update_command(
    actor_id: Uuid,
    organization_id: Uuid,
    target_user_id: Uuid,
    role: &str,
) -> UpdateMemberRoleCommand {
    UpdateMemberRoleCommand {
        organization_id,
        actor_id,
        target_user_id,
        role: role.to_owned(),
    }
}

fn remove_command(
    actor_id: Uuid,
    organization_id: Uuid,
    target_user_id: Uuid,
) -> RemoveMemberCommand {
    RemoveMemberCommand {
        organization_id,
        actor_id,
        target_user_id,
    }
}

fn register_command(email: &str, display_name: &str) -> RegisterCommand {
    RegisterCommand {
        email: email.to_owned(),
        display_name: display_name.to_owned(),
        password: SecretString::from("correct horse battery staple".to_owned()),
    }
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
