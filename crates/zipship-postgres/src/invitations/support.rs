use super::row::parse_role;
use sqlx::{Postgres, Transaction};
use time::OffsetDateTime;
use uuid::Uuid;
use zipship_domain::MemberRole;
use zipship_invitations::{InvitationPolicyError, InvitationsRepositoryError};

pub(super) async fn lock_organization_and_actor(
    transaction: &mut Transaction<'_, Postgres>,
    organization_id: Uuid,
    actor_id: Uuid,
) -> Result<MemberRole, InvitationsRepositoryError> {
    lock_organization(transaction, organization_id).await?;
    let role = sqlx::query_scalar::<_, String>(
        r#"
        SELECT role
        FROM memberships
        WHERE organization_id = $1 AND user_id = $2
        FOR UPDATE
        "#,
    )
    .bind(organization_id)
    .bind(actor_id)
    .fetch_optional(&mut **transaction)
    .await
    .map_err(InvitationsRepositoryError::unavailable)?
    .ok_or(InvitationsRepositoryError::Forbidden)?;
    parse_role(&role)
}

pub(super) async fn lock_organization(
    transaction: &mut Transaction<'_, Postgres>,
    organization_id: Uuid,
) -> Result<(), InvitationsRepositoryError> {
    let exists = sqlx::query_scalar::<_, Uuid>(
        r#"
        SELECT id
        FROM organizations
        WHERE id = $1 AND deleted_at IS NULL
        FOR UPDATE
        "#,
    )
    .bind(organization_id)
    .fetch_optional(&mut **transaction)
    .await
    .map_err(InvitationsRepositoryError::unavailable)?
    .is_some();
    if !exists {
        return Err(InvitationsRepositoryError::Forbidden);
    }
    Ok(())
}

pub(super) async fn expire_invitation(
    transaction: &mut Transaction<'_, Postgres>,
    invitation_id: Uuid,
    expired_at: OffsetDateTime,
) -> Result<(), InvitationsRepositoryError> {
    sqlx::query("UPDATE invitations SET state = 'expired', resolved_at = $2 WHERE id = $1")
        .bind(invitation_id)
        .bind(expired_at)
        .execute(&mut **transaction)
        .await
        .map_err(InvitationsRepositoryError::unavailable)?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
pub(super) async fn insert_audit(
    transaction: &mut Transaction<'_, Postgres>,
    organization_id: Uuid,
    actor_id: Uuid,
    action: &str,
    target_type: &str,
    target_id: Uuid,
    metadata: serde_json::Value,
    created_at: OffsetDateTime,
) -> Result<(), InvitationsRepositoryError> {
    sqlx::query(
        r#"
        INSERT INTO audit_logs (
            organization_id,
            actor_id,
            action,
            target_type,
            target_id,
            metadata,
            created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        "#,
    )
    .bind(organization_id)
    .bind(actor_id)
    .bind(action)
    .bind(target_type)
    .bind(target_id)
    .bind(metadata)
    .bind(created_at)
    .execute(&mut **transaction)
    .await
    .map_err(InvitationsRepositoryError::unavailable)?;
    Ok(())
}

pub(super) fn map_policy_error(_error: InvitationPolicyError) -> InvitationsRepositoryError {
    InvitationsRepositoryError::Forbidden
}

pub(super) fn map_create_error(error: sqlx::Error) -> InvitationsRepositoryError {
    if constraint_name(&error) == Some("invitations_organization_email_pending_unique") {
        InvitationsRepositoryError::Pending
    } else {
        InvitationsRepositoryError::unavailable(error)
    }
}

pub(super) fn map_membership_insert_error(error: sqlx::Error) -> InvitationsRepositoryError {
    if constraint_name(&error) == Some("memberships_pkey") {
        InvitationsRepositoryError::AlreadyMember
    } else {
        InvitationsRepositoryError::unavailable(error)
    }
}

fn constraint_name(error: &sqlx::Error) -> Option<&str> {
    error.as_database_error()?.constraint()
}
