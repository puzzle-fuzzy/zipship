use async_trait::async_trait;
use sqlx::{FromRow, PgPool};
use thiserror::Error;
use time::OffsetDateTime;
use uuid::Uuid;
use zipship_auth::{
    AuthRepository, AuthRepositoryError, DisplayName, EncodedPasswordHash, NewSession, NewUser,
    NormalizedEmail, ResolvedSession, StoredUser, TokenDigest,
};

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

        insert_session(&mut transaction, &session).await?;
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

#[derive(Debug, FromRow)]
struct UserRow {
    id: Uuid,
    email: String,
    display_name: String,
    password_hash: String,
    disabled_at: Option<OffsetDateTime>,
}

impl TryFrom<UserRow> for StoredUser {
    type Error = AuthRepositoryError;

    fn try_from(row: UserRow) -> Result<Self, Self::Error> {
        Ok(Self {
            id: row.id,
            email: NormalizedEmail::parse(&row.email).map_err(|_| corrupt_record("users.email"))?,
            display_name: DisplayName::parse(&row.display_name)
                .map_err(|_| corrupt_record("users.display_name"))?,
            password_hash: EncodedPasswordHash::parse(row.password_hash)
                .map_err(|_| corrupt_record("users.password_hash"))?,
            disabled_at: row.disabled_at,
        })
    }
}

#[derive(Debug, FromRow)]
struct ResolvedSessionRow {
    session_id: Uuid,
    csrf_secret_hash: Vec<u8>,
    user_id: Uuid,
    email: String,
    display_name: String,
    password_hash: String,
    disabled_at: Option<OffsetDateTime>,
}

impl TryFrom<ResolvedSessionRow> for ResolvedSession {
    type Error = AuthRepositoryError;

    fn try_from(row: ResolvedSessionRow) -> Result<Self, Self::Error> {
        let csrf_digest = TokenDigest::from_slice(&row.csrf_secret_hash)
            .ok_or_else(|| corrupt_record("web_sessions.csrf_secret_hash"))?;
        let user = StoredUser::try_from(UserRow {
            id: row.user_id,
            email: row.email,
            display_name: row.display_name,
            password_hash: row.password_hash,
            disabled_at: row.disabled_at,
        })?;
        Ok(Self {
            session_id: row.session_id,
            user,
            csrf_digest,
        })
    }
}

#[derive(Debug, Error)]
#[error("database contains an invalid authentication value in {field}")]
struct CorruptAuthRecord {
    field: &'static str,
}

fn corrupt_record(field: &'static str) -> AuthRepositoryError {
    AuthRepositoryError::unavailable(CorruptAuthRecord { field })
}

#[cfg(test)]
mod tests {
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
}
