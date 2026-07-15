use async_trait::async_trait;
use sqlx::PgPool;
use time::OffsetDateTime;
use uuid::Uuid;
use zipship_auth::{
    AuthRepository, AuthRepositoryError, DisplayName, NewPersonalOrganization, NewSession, NewUser,
    NormalizedEmail, ResolvedSession, StoredUser, TokenDigest,
};

mod row;

use row::{ResolvedSessionRow, UserRow};

#[derive(Debug, Clone)]
pub struct PgAuthRepository {
    pool: PgPool,
}

impl PgAuthRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl AuthRepository for PgAuthRepository {
    async fn create_user_with_session(
        &self,
        user: NewUser,
        organization: NewPersonalOrganization,
        session: NewSession,
    ) -> Result<(), AuthRepositoryError> {
        let mut transaction = self
            .pool
            .begin()
            .await
            .map_err(AuthRepositoryError::unavailable)?;

        let insert_user = sqlx::query(
            r#"
            INSERT INTO users (id, email, display_name, password_hash, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $5)
            "#,
        )
        .bind(user.id)
        .bind(user.email.as_str())
        .bind(user.display_name.as_str())
        .bind(user.password_hash.as_str())
        .bind(user.created_at)
        .execute(&mut *transaction)
        .await;

        if let Err(error) = insert_user {
            return Err(map_user_insert_error(error));
        }

        sqlx::query(
            r#"
            INSERT INTO organizations (id, name, slug, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $4)
            "#,
        )
        .bind(organization.id)
        .bind(organization.name.as_str())
        .bind(organization.slug.as_str())
        .bind(organization.created_at)
        .execute(&mut *transaction)
        .await
        .map_err(AuthRepositoryError::unavailable)?;

        sqlx::query(
            r#"
            INSERT INTO memberships (organization_id, user_id, role, created_at, updated_at)
            VALUES ($1, $2, 'owner', $3, $3)
            "#,
        )
        .bind(organization.id)
        .bind(user.id)
        .bind(organization.created_at)
        .execute(&mut *transaction)
        .await
        .map_err(AuthRepositoryError::unavailable)?;

        insert_session(&mut transaction, &session).await?;

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
            VALUES ($1, $2, 'organization.created', 'organization', $1, '{}'::jsonb, $3)
            "#,
        )
        .bind(organization.id)
        .bind(user.id)
        .bind(organization.created_at)
        .execute(&mut *transaction)
        .await
        .map_err(AuthRepositoryError::unavailable)?;

        transaction
            .commit()
            .await
            .map_err(AuthRepositoryError::unavailable)
    }

    async fn find_user_by_email(
        &self,
        email: &NormalizedEmail,
    ) -> Result<Option<StoredUser>, AuthRepositoryError> {
        let row = sqlx::query_as::<_, UserRow>(
            r#"
            SELECT id, email, display_name, password_hash, disabled_at
            FROM users
            WHERE email = $1
            "#,
        )
        .bind(email.as_str())
        .fetch_optional(&self.pool)
        .await
        .map_err(AuthRepositoryError::unavailable)?;
        row.map(TryInto::try_into).transpose()
    }

    async fn create_session(&self, session: NewSession) -> Result<(), AuthRepositoryError> {
        let mut transaction = self
            .pool
            .begin()
            .await
            .map_err(AuthRepositoryError::unavailable)?;
        insert_session(&mut transaction, &session).await?;
        transaction
            .commit()
            .await
            .map_err(AuthRepositoryError::unavailable)
    }

    async fn update_display_name(
        &self,
        user_id: Uuid,
        display_name: DisplayName,
        updated_at: OffsetDateTime,
    ) -> Result<StoredUser, AuthRepositoryError> {
        let mut transaction = self
            .pool
            .begin()
            .await
            .map_err(AuthRepositoryError::unavailable)?;
        let current = sqlx::query_as::<_, UserRow>(
            r#"
            SELECT id, email, display_name, password_hash, disabled_at
            FROM users
            WHERE id = $1
            FOR UPDATE
            "#,
        )
        .bind(user_id)
        .fetch_optional(&mut *transaction)
        .await
        .map_err(AuthRepositoryError::unavailable)?
        .ok_or(AuthRepositoryError::UserNotFound)?;
        let current = StoredUser::try_from(current)?;

        if current.display_name == display_name {
            transaction
                .commit()
                .await
                .map_err(AuthRepositoryError::unavailable)?;
            return Ok(current);
        }

        let updated = sqlx::query_as::<_, UserRow>(
            r#"
            UPDATE users
            SET display_name = $2, updated_at = $3
            WHERE id = $1
            RETURNING id, email, display_name, password_hash, disabled_at
            "#,
        )
        .bind(user_id)
        .bind(display_name.as_str())
        .bind(updated_at)
        .fetch_one(&mut *transaction)
        .await
        .map_err(AuthRepositoryError::unavailable)?;

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
            SELECT
                memberships.organization_id,
                $1,
                'user.profile_updated',
                'user',
                $1,
                '{"changedFields":["displayName"]}'::jsonb,
                $2
            FROM memberships
            INNER JOIN organizations ON organizations.id = memberships.organization_id
            WHERE memberships.user_id = $1 AND organizations.deleted_at IS NULL
            "#,
        )
        .bind(user_id)
        .bind(updated_at)
        .execute(&mut *transaction)
        .await
        .map_err(AuthRepositoryError::unavailable)?;

        transaction
            .commit()
            .await
            .map_err(AuthRepositoryError::unavailable)?;
        StoredUser::try_from(updated)
    }

    async fn resolve_session(
        &self,
        token_digest: TokenDigest,
        now: OffsetDateTime,
    ) -> Result<Option<ResolvedSession>, AuthRepositoryError> {
        let row = sqlx::query_as::<_, ResolvedSessionRow>(
            r#"
            WITH touched AS (
                UPDATE web_sessions
                SET last_seen_at = $2
                WHERE token_hash = $1
                  AND revoked_at IS NULL
                  AND expires_at > $2
                  AND (last_seen_at IS NULL OR last_seen_at < $2 - INTERVAL '5 minutes')
                RETURNING id, user_id, csrf_secret_hash
            ), active AS (
                SELECT id, user_id, csrf_secret_hash
                FROM web_sessions
                WHERE token_hash = $1
                  AND revoked_at IS NULL
                  AND expires_at > $2
            ), selected_session AS (
                SELECT id, user_id, csrf_secret_hash FROM touched
                UNION ALL
                SELECT id, user_id, csrf_secret_hash FROM active
                WHERE NOT EXISTS (SELECT 1 FROM touched)
            )
            SELECT
                selected_session.id AS session_id,
                selected_session.csrf_secret_hash,
                users.id AS user_id,
                users.email,
                users.display_name,
                users.password_hash,
                users.disabled_at
            FROM selected_session
            INNER JOIN users ON users.id = selected_session.user_id
            "#,
        )
        .bind(token_digest.as_bytes().as_slice())
        .bind(now)
        .fetch_optional(&self.pool)
        .await
        .map_err(AuthRepositoryError::unavailable)?;
        row.map(TryInto::try_into).transpose()
    }

    async fn revoke_session(
        &self,
        token_digest: TokenDigest,
        revoked_at: OffsetDateTime,
    ) -> Result<(), AuthRepositoryError> {
        sqlx::query(
            r#"
            UPDATE web_sessions
            SET revoked_at = $2
            WHERE token_hash = $1 AND revoked_at IS NULL
            "#,
        )
        .bind(token_digest.as_bytes().as_slice())
        .bind(revoked_at)
        .execute(&self.pool)
        .await
        .map_err(AuthRepositoryError::unavailable)?;
        Ok(())
    }
}

async fn insert_session(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    session: &NewSession,
) -> Result<(), AuthRepositoryError> {
    sqlx::query(
        r#"
        INSERT INTO web_sessions (
            id,
            user_id,
            token_hash,
            csrf_secret_hash,
            expires_at,
            created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        "#,
    )
    .bind(session.id)
    .bind(session.user_id)
    .bind(session.token_digest.as_bytes().as_slice())
    .bind(session.csrf_digest.as_bytes().as_slice())
    .bind(session.expires_at)
    .bind(session.created_at)
    .execute(&mut **transaction)
    .await
    .map_err(AuthRepositoryError::unavailable)?;
    Ok(())
}

fn map_user_insert_error(error: sqlx::Error) -> AuthRepositoryError {
    if let sqlx::Error::Database(database_error) = &error
        && database_error.constraint() == Some("users_email_unique")
    {
        return AuthRepositoryError::DuplicateEmail;
    }
    AuthRepositoryError::unavailable(error)
}

#[cfg(test)]
mod tests;
