use async_trait::async_trait;
use serde_json::json;
use sqlx::PgPool;
use uuid::Uuid;
use zipship_domain::PermissionAction;
use zipship_invitations::{
    AcceptInvitation, AcceptedInvitation, Invitation, InvitationState, InvitationsRepository,
    InvitationsRepositoryError, ListInvitations, NewInvitation, RevokeInvitation,
    validate_invitation_management,
};

mod row;
mod support;

use row::InvitationRow;
use support::{
    expire_invitation, insert_audit, lock_organization, lock_organization_and_actor,
    map_create_error, map_membership_insert_error, map_policy_error,
};

#[derive(Debug, Clone)]
pub struct PgInvitationsRepository {
    pool: PgPool,
}

impl PgInvitationsRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl InvitationsRepository for PgInvitationsRepository {
    async fn create_invitation(
        &self,
        invitation: NewInvitation,
    ) -> Result<Invitation, InvitationsRepositoryError> {
        let mut transaction = self
            .pool
            .begin()
            .await
            .map_err(InvitationsRepositoryError::unavailable)?;
        let actor_role = lock_organization_and_actor(
            &mut transaction,
            invitation.organization_id,
            invitation.invited_by,
        )
        .await?;
        validate_invitation_management(actor_role, invitation.role).map_err(map_policy_error)?;

        sqlx::query(
            r#"
            UPDATE invitations
            SET state = 'expired', resolved_at = $3
            WHERE organization_id = $1
              AND email = $2
              AND state = 'pending'
              AND expires_at <= $3
            "#,
        )
        .bind(invitation.organization_id)
        .bind(invitation.email.as_str())
        .bind(invitation.created_at)
        .execute(&mut *transaction)
        .await
        .map_err(InvitationsRepositoryError::unavailable)?;

        let already_member = sqlx::query_scalar::<_, bool>(
            r#"
            SELECT EXISTS (
                SELECT 1
                FROM memberships
                INNER JOIN users ON users.id = memberships.user_id
                WHERE memberships.organization_id = $1
                  AND users.email = $2
            )
            "#,
        )
        .bind(invitation.organization_id)
        .bind(invitation.email.as_str())
        .fetch_one(&mut *transaction)
        .await
        .map_err(InvitationsRepositoryError::unavailable)?;
        if already_member {
            return Err(InvitationsRepositoryError::AlreadyMember);
        }

        let active_invitation = sqlx::query_scalar::<_, bool>(
            r#"
            SELECT EXISTS (
                SELECT 1
                FROM invitations
                WHERE organization_id = $1
                  AND email = $2
                  AND state = 'pending'
            )
            "#,
        )
        .bind(invitation.organization_id)
        .bind(invitation.email.as_str())
        .fetch_one(&mut *transaction)
        .await
        .map_err(InvitationsRepositoryError::unavailable)?;
        if active_invitation {
            return Err(InvitationsRepositoryError::Pending);
        }

        let row = sqlx::query_as::<_, InvitationRow>(
            r#"
            INSERT INTO invitations (
                id,
                organization_id,
                email,
                role,
                token_hash,
                state,
                invited_by,
                created_at,
                expires_at
            )
            VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7, $8)
            RETURNING
                id,
                organization_id,
                email,
                role,
                state,
                invited_by,
                accepted_by,
                created_at,
                expires_at,
                resolved_at
            "#,
        )
        .bind(invitation.id)
        .bind(invitation.organization_id)
        .bind(invitation.email.as_str())
        .bind(invitation.role.as_str())
        .bind(invitation.token_digest.as_bytes().as_slice())
        .bind(invitation.invited_by)
        .bind(invitation.created_at)
        .bind(invitation.expires_at)
        .fetch_one(&mut *transaction)
        .await
        .map_err(map_create_error)?;
        insert_audit(
            &mut transaction,
            invitation.organization_id,
            invitation.invited_by,
            "invitation.created",
            "invitation",
            invitation.id,
            json!({
                "email": invitation.email.as_str(),
                "role": invitation.role.as_str(),
            }),
            invitation.created_at,
        )
        .await?;
        transaction
            .commit()
            .await
            .map_err(InvitationsRepositoryError::unavailable)?;
        row.try_into()
    }

    async fn list_invitations(
        &self,
        request: ListInvitations,
    ) -> Result<Vec<Invitation>, InvitationsRepositoryError> {
        let mut transaction = self
            .pool
            .begin()
            .await
            .map_err(InvitationsRepositoryError::unavailable)?;
        let actor_role = lock_organization_and_actor(
            &mut transaction,
            request.organization_id,
            request.actor_id,
        )
        .await?;
        if !actor_role.can(PermissionAction::ManageMember) {
            return Err(InvitationsRepositoryError::Forbidden);
        }
        sqlx::query(
            r#"
            UPDATE invitations
            SET state = 'expired', resolved_at = $2
            WHERE organization_id = $1
              AND state = 'pending'
              AND expires_at <= $2
            "#,
        )
        .bind(request.organization_id)
        .bind(request.now)
        .execute(&mut *transaction)
        .await
        .map_err(InvitationsRepositoryError::unavailable)?;

        let rows = sqlx::query_as::<_, InvitationRow>(
            r#"
            SELECT
                id,
                organization_id,
                email,
                role,
                state,
                invited_by,
                accepted_by,
                created_at,
                expires_at,
                resolved_at
            FROM invitations
            WHERE organization_id = $1
              AND state = 'pending'
              AND expires_at > $2
              AND ($3 = 'owner' OR role <> 'owner')
            ORDER BY created_at ASC, id ASC
            "#,
        )
        .bind(request.organization_id)
        .bind(request.now)
        .bind(actor_role.as_str())
        .fetch_all(&mut *transaction)
        .await
        .map_err(InvitationsRepositoryError::unavailable)?;
        let invitations = rows
            .into_iter()
            .map(TryInto::try_into)
            .collect::<Result<Vec<_>, _>>()?;
        transaction
            .commit()
            .await
            .map_err(InvitationsRepositoryError::unavailable)?;
        Ok(invitations)
    }

    async fn revoke_invitation(
        &self,
        request: RevokeInvitation,
    ) -> Result<(), InvitationsRepositoryError> {
        let mut transaction = self
            .pool
            .begin()
            .await
            .map_err(InvitationsRepositoryError::unavailable)?;
        let actor_role = lock_organization_and_actor(
            &mut transaction,
            request.organization_id,
            request.actor_id,
        )
        .await?;
        let row = sqlx::query_as::<_, InvitationRow>(
            r#"
            SELECT
                id,
                organization_id,
                email,
                role,
                state,
                invited_by,
                accepted_by,
                created_at,
                expires_at,
                resolved_at
            FROM invitations
            WHERE organization_id = $1 AND id = $2
            FOR UPDATE
            "#,
        )
        .bind(request.organization_id)
        .bind(request.invitation_id)
        .fetch_optional(&mut *transaction)
        .await
        .map_err(InvitationsRepositoryError::unavailable)?
        .ok_or(InvitationsRepositoryError::NotFound)?;
        let invitation = Invitation::try_from(row)?;
        if invitation.state != InvitationState::Pending {
            return Err(InvitationsRepositoryError::NotFound);
        }
        validate_invitation_management(actor_role, invitation.role).map_err(map_policy_error)?;
        if invitation.expires_at <= request.revoked_at {
            expire_invitation(&mut transaction, invitation.id, request.revoked_at).await?;
            transaction
                .commit()
                .await
                .map_err(InvitationsRepositoryError::unavailable)?;
            return Err(InvitationsRepositoryError::Expired);
        }

        sqlx::query("UPDATE invitations SET state = 'revoked', resolved_at = $2 WHERE id = $1")
            .bind(invitation.id)
            .bind(request.revoked_at)
            .execute(&mut *transaction)
            .await
            .map_err(InvitationsRepositoryError::unavailable)?;
        insert_audit(
            &mut transaction,
            request.organization_id,
            request.actor_id,
            "invitation.revoked",
            "invitation",
            invitation.id,
            json!({
                "email": invitation.email,
                "role": invitation.role.as_str(),
            }),
            request.revoked_at,
        )
        .await?;
        transaction
            .commit()
            .await
            .map_err(InvitationsRepositoryError::unavailable)?;
        Ok(())
    }

    async fn accept_invitation(
        &self,
        request: AcceptInvitation,
    ) -> Result<AcceptedInvitation, InvitationsRepositoryError> {
        let organization_id = sqlx::query_scalar::<_, Uuid>(
            "SELECT organization_id FROM invitations WHERE token_hash = $1",
        )
        .bind(request.token_digest.as_bytes().as_slice())
        .fetch_optional(&self.pool)
        .await
        .map_err(InvitationsRepositoryError::unavailable)?
        .ok_or(InvitationsRepositoryError::NotFound)?;
        let mut transaction = self
            .pool
            .begin()
            .await
            .map_err(InvitationsRepositoryError::unavailable)?;
        lock_organization(&mut transaction, organization_id).await?;
        let row = sqlx::query_as::<_, InvitationRow>(
            r#"
            SELECT
                id,
                organization_id,
                email,
                role,
                state,
                invited_by,
                accepted_by,
                created_at,
                expires_at,
                resolved_at
            FROM invitations
            WHERE token_hash = $1
            FOR UPDATE
            "#,
        )
        .bind(request.token_digest.as_bytes().as_slice())
        .fetch_optional(&mut *transaction)
        .await
        .map_err(InvitationsRepositoryError::unavailable)?
        .ok_or(InvitationsRepositoryError::NotFound)?;
        let invitation = Invitation::try_from(row)?;

        match invitation.state {
            InvitationState::Accepted if invitation.accepted_by == Some(request.actor_id) => {
                transaction
                    .commit()
                    .await
                    .map_err(InvitationsRepositoryError::unavailable)?;
                return Ok(AcceptedInvitation {
                    invitation_id: invitation.id,
                    organization_id: invitation.organization_id,
                    user_id: request.actor_id,
                    role: invitation.role,
                    replayed: true,
                });
            }
            InvitationState::Accepted => {
                return Err(InvitationsRepositoryError::WrongRecipient);
            }
            InvitationState::Expired => return Err(InvitationsRepositoryError::Expired),
            InvitationState::Revoked => return Err(InvitationsRepositoryError::NotFound),
            InvitationState::Pending => {}
        }
        if invitation.expires_at <= request.accepted_at {
            expire_invitation(&mut transaction, invitation.id, request.accepted_at).await?;
            transaction
                .commit()
                .await
                .map_err(InvitationsRepositoryError::unavailable)?;
            return Err(InvitationsRepositoryError::Expired);
        }
        if invitation.email != request.actor_email.as_str() {
            return Err(InvitationsRepositoryError::WrongRecipient);
        }

        let already_member = sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS(SELECT 1 FROM memberships WHERE organization_id = $1 AND user_id = $2)",
        )
        .bind(invitation.organization_id)
        .bind(request.actor_id)
        .fetch_one(&mut *transaction)
        .await
        .map_err(InvitationsRepositoryError::unavailable)?;
        if already_member {
            sqlx::query("UPDATE invitations SET state = 'revoked', resolved_at = $2 WHERE id = $1")
                .bind(invitation.id)
                .bind(request.accepted_at)
                .execute(&mut *transaction)
                .await
                .map_err(InvitationsRepositoryError::unavailable)?;
            insert_audit(
                &mut transaction,
                invitation.organization_id,
                request.actor_id,
                "invitation.invalidated",
                "invitation",
                invitation.id,
                json!({ "reason": "already_member" }),
                request.accepted_at,
            )
            .await?;
            transaction
                .commit()
                .await
                .map_err(InvitationsRepositoryError::unavailable)?;
            return Err(InvitationsRepositoryError::AlreadyMember);
        }

        sqlx::query(
            r#"
            INSERT INTO memberships (organization_id, user_id, role, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $4)
            "#,
        )
        .bind(invitation.organization_id)
        .bind(request.actor_id)
        .bind(invitation.role.as_str())
        .bind(request.accepted_at)
        .execute(&mut *transaction)
        .await
        .map_err(map_membership_insert_error)?;
        sqlx::query(
            r#"
            UPDATE invitations
            SET state = 'accepted', accepted_by = $2, resolved_at = $3
            WHERE id = $1
            "#,
        )
        .bind(invitation.id)
        .bind(request.actor_id)
        .bind(request.accepted_at)
        .execute(&mut *transaction)
        .await
        .map_err(InvitationsRepositoryError::unavailable)?;
        insert_audit(
            &mut transaction,
            invitation.organization_id,
            request.actor_id,
            "member.joined",
            "member",
            request.actor_id,
            json!({
                "invitationId": invitation.id,
                "role": invitation.role.as_str(),
            }),
            request.accepted_at,
        )
        .await?;
        transaction
            .commit()
            .await
            .map_err(InvitationsRepositoryError::unavailable)?;
        Ok(AcceptedInvitation {
            invitation_id: invitation.id,
            organization_id: invitation.organization_id,
            user_id: request.actor_id,
            role: invitation.role,
            replayed: false,
        })
    }
}

#[cfg(test)]
mod tests;
