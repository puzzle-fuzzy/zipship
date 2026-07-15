use async_trait::async_trait;
use serde_json::json;
use sqlx::{FromRow, PgPool};
use std::str::FromStr;
use thiserror::Error;
use time::OffsetDateTime;
use uuid::Uuid;
use zipship_domain::MemberRole;
use zipship_members::{
    Member, MembersRepository, MembersRepositoryError, RemoveMember, RoleChangePolicyError,
    UpdateMemberRole, validate_member_removal, validate_role_change,
};

#[derive(Debug, Clone)]
pub struct PgMembersRepository {
    pool: PgPool,
}

impl PgMembersRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl MembersRepository for PgMembersRepository {
    async fn list_members(
        &self,
        organization_id: Uuid,
        actor_id: Uuid,
    ) -> Result<Vec<Member>, MembersRepositoryError> {
        let rows = sqlx::query_as::<_, MemberRow>(
            r#"
            SELECT
                users.id AS user_id,
                users.email,
                users.display_name,
                target_membership.role,
                target_membership.created_at AS joined_at
            FROM memberships AS target_membership
            INNER JOIN users ON users.id = target_membership.user_id
            INNER JOIN organizations ON organizations.id = target_membership.organization_id
            WHERE target_membership.organization_id = $1
              AND organizations.deleted_at IS NULL
              AND EXISTS (
                  SELECT 1
                  FROM memberships AS actor_membership
                  WHERE actor_membership.organization_id = $1
                    AND actor_membership.user_id = $2
              )
            ORDER BY target_membership.created_at ASC, users.id ASC
            "#,
        )
        .bind(organization_id)
        .bind(actor_id)
        .fetch_all(&self.pool)
        .await
        .map_err(MembersRepositoryError::unavailable)?;
        if rows.is_empty() {
            return Err(MembersRepositoryError::Forbidden);
        }
        rows.into_iter().map(TryInto::try_into).collect()
    }

    async fn update_role(
        &self,
        update: UpdateMemberRole,
    ) -> Result<Member, MembersRepositoryError> {
        let mut transaction = self
            .pool
            .begin()
            .await
            .map_err(MembersRepositoryError::unavailable)?;
        // Every membership mutation must lock the organization first. This serializes owner-count
        // decisions across different target members; removal must follow the same lock order.
        let organization_exists = sqlx::query_scalar::<_, Uuid>(
            r#"
            SELECT id
            FROM organizations
            WHERE id = $1 AND deleted_at IS NULL
            FOR UPDATE
            "#,
        )
        .bind(update.organization_id)
        .fetch_optional(&mut *transaction)
        .await
        .map_err(MembersRepositoryError::unavailable)?
        .is_some();
        if !organization_exists {
            return Err(MembersRepositoryError::Forbidden);
        }

        let actor_role = sqlx::query_scalar::<_, String>(
            r#"
            SELECT role
            FROM memberships
            WHERE organization_id = $1 AND user_id = $2
            FOR UPDATE
            "#,
        )
        .bind(update.organization_id)
        .bind(update.actor_id)
        .fetch_optional(&mut *transaction)
        .await
        .map_err(MembersRepositoryError::unavailable)?
        .ok_or(MembersRepositoryError::Forbidden)?;
        let actor_role = parse_role(&actor_role)?;

        let target = sqlx::query_as::<_, MemberRow>(
            r#"
            SELECT
                users.id AS user_id,
                users.email,
                users.display_name,
                target_membership.role,
                target_membership.created_at AS joined_at
            FROM memberships AS target_membership
            INNER JOIN users ON users.id = target_membership.user_id
            WHERE target_membership.organization_id = $1
              AND target_membership.user_id = $2
            FOR UPDATE OF target_membership
            "#,
        )
        .bind(update.organization_id)
        .bind(update.target_user_id)
        .fetch_optional(&mut *transaction)
        .await
        .map_err(MembersRepositoryError::unavailable)?
        .ok_or(MembersRepositoryError::NotFound)?;
        let mut target = Member::try_from(target)?;
        let owner_count = sqlx::query_scalar::<_, i64>(
            "SELECT count(*) FROM memberships WHERE organization_id = $1 AND role = 'owner'",
        )
        .bind(update.organization_id)
        .fetch_one(&mut *transaction)
        .await
        .map_err(MembersRepositoryError::unavailable)?;
        let owner_count = u64::try_from(owner_count).map_err(corrupt_owner_count)?;
        validate_role_change(actor_role, target.role, update.role, owner_count)
            .map_err(map_policy_error)?;

        if target.role == update.role {
            transaction
                .commit()
                .await
                .map_err(MembersRepositoryError::unavailable)?;
            return Ok(target);
        }

        let previous_role = target.role;
        sqlx::query(
            r#"
            UPDATE memberships
            SET role = $3, updated_at = $4
            WHERE organization_id = $1 AND user_id = $2
            "#,
        )
        .bind(update.organization_id)
        .bind(update.target_user_id)
        .bind(update.role.as_str())
        .bind(update.updated_at)
        .execute(&mut *transaction)
        .await
        .map_err(MembersRepositoryError::unavailable)?;
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
            VALUES ($1, $2, 'member.role_updated', 'member', $3, $4, $5)
            "#,
        )
        .bind(update.organization_id)
        .bind(update.actor_id)
        .bind(update.target_user_id)
        .bind(json!({
            "previousRole": previous_role.as_str(),
            "role": update.role.as_str(),
        }))
        .bind(update.updated_at)
        .execute(&mut *transaction)
        .await
        .map_err(MembersRepositoryError::unavailable)?;
        transaction
            .commit()
            .await
            .map_err(MembersRepositoryError::unavailable)?;

        target.role = update.role;
        Ok(target)
    }

    async fn remove_member(&self, removal: RemoveMember) -> Result<(), MembersRepositoryError> {
        let mut transaction = self
            .pool
            .begin()
            .await
            .map_err(MembersRepositoryError::unavailable)?;
        let organization_exists = sqlx::query_scalar::<_, Uuid>(
            r#"
            SELECT id
            FROM organizations
            WHERE id = $1 AND deleted_at IS NULL
            FOR UPDATE
            "#,
        )
        .bind(removal.organization_id)
        .fetch_optional(&mut *transaction)
        .await
        .map_err(MembersRepositoryError::unavailable)?
        .is_some();
        if !organization_exists {
            return Err(MembersRepositoryError::Forbidden);
        }

        let actor_role = sqlx::query_scalar::<_, String>(
            r#"
            SELECT role
            FROM memberships
            WHERE organization_id = $1 AND user_id = $2
            FOR UPDATE
            "#,
        )
        .bind(removal.organization_id)
        .bind(removal.actor_id)
        .fetch_optional(&mut *transaction)
        .await
        .map_err(MembersRepositoryError::unavailable)?
        .ok_or(MembersRepositoryError::Forbidden)?;
        let actor_role = parse_role(&actor_role)?;

        let target_role = sqlx::query_scalar::<_, String>(
            r#"
            SELECT role
            FROM memberships
            WHERE organization_id = $1 AND user_id = $2
            FOR UPDATE
            "#,
        )
        .bind(removal.organization_id)
        .bind(removal.target_user_id)
        .fetch_optional(&mut *transaction)
        .await
        .map_err(MembersRepositoryError::unavailable)?
        .ok_or(MembersRepositoryError::NotFound)?;
        let target_role = parse_role(&target_role)?;
        let owner_count = sqlx::query_scalar::<_, i64>(
            "SELECT count(*) FROM memberships WHERE organization_id = $1 AND role = 'owner'",
        )
        .bind(removal.organization_id)
        .fetch_one(&mut *transaction)
        .await
        .map_err(MembersRepositoryError::unavailable)?;
        let owner_count = u64::try_from(owner_count).map_err(corrupt_owner_count)?;
        let is_self_removal = removal.actor_id == removal.target_user_id;
        validate_member_removal(is_self_removal, actor_role, target_role, owner_count)
            .map_err(map_policy_error)?;

        let deleted =
            sqlx::query("DELETE FROM memberships WHERE organization_id = $1 AND user_id = $2")
                .bind(removal.organization_id)
                .bind(removal.target_user_id)
                .execute(&mut *transaction)
                .await
                .map_err(MembersRepositoryError::unavailable)?;
        if deleted.rows_affected() != 1 {
            return Err(MembersRepositoryError::NotFound);
        }
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
            VALUES ($1, $2, 'member.removed', 'member', $3, $4, $5)
            "#,
        )
        .bind(removal.organization_id)
        .bind(removal.actor_id)
        .bind(removal.target_user_id)
        .bind(json!({
            "role": target_role.as_str(),
            "selfRemoval": is_self_removal,
        }))
        .bind(removal.removed_at)
        .execute(&mut *transaction)
        .await
        .map_err(MembersRepositoryError::unavailable)?;
        transaction
            .commit()
            .await
            .map_err(MembersRepositoryError::unavailable)?;

        Ok(())
    }
}

fn map_policy_error(error: RoleChangePolicyError) -> MembersRepositoryError {
    match error {
        RoleChangePolicyError::Forbidden => MembersRepositoryError::Forbidden,
        RoleChangePolicyError::LastOwner => MembersRepositoryError::LastOwner,
    }
}

fn parse_role(value: &str) -> Result<MemberRole, MembersRepositoryError> {
    MemberRole::from_str(value).map_err(|_| corrupt_record("memberships.role"))
}

fn corrupt_owner_count(error: std::num::TryFromIntError) -> MembersRepositoryError {
    MembersRepositoryError::unavailable(error)
}

#[derive(Debug, FromRow)]
struct MemberRow {
    user_id: Uuid,
    email: String,
    display_name: String,
    role: String,
    joined_at: OffsetDateTime,
}

impl TryFrom<MemberRow> for Member {
    type Error = MembersRepositoryError;

    fn try_from(row: MemberRow) -> Result<Self, Self::Error> {
        Ok(Self {
            user_id: row.user_id,
            email: row.email,
            display_name: row.display_name,
            role: parse_role(&row.role)?,
            joined_at: row.joined_at,
        })
    }
}

#[derive(Debug, Error)]
#[error("database contains an invalid members value in {field}")]
struct CorruptMemberRecord {
    field: &'static str,
}

fn corrupt_record(field: &'static str) -> MembersRepositoryError {
    MembersRepositoryError::unavailable(CorruptMemberRecord { field })
}

#[cfg(test)]
mod tests;
