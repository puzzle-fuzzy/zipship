use async_trait::async_trait;
use sqlx::{PgPool, Postgres, Transaction};
use time::OffsetDateTime;
use uuid::Uuid;
use zipship_tokens::{
    API_TOKEN_HISTORY_LIMIT, ApiToken, ApiTokensRepository, ApiTokensRepositoryError,
    ListApiTokens, NewApiToken, ResolveApiToken, ResolvedApiToken, RevokeApiToken,
};

mod row;

use row::{ApiTokenRow, corrupt_record};

const LAST_USED_WRITE_INTERVAL_MINUTES: i32 = 5;

#[derive(Debug, Clone)]
pub struct PgApiTokensRepository {
    pool: PgPool,
}

impl PgApiTokensRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl ApiTokensRepository for PgApiTokensRepository {
    async fn create_token(
        &self,
        token: NewApiToken,
        active_token_limit: u16,
    ) -> Result<ApiToken, ApiTokensRepositoryError> {
        let mut transaction = self
            .pool
            .begin()
            .await
            .map_err(ApiTokensRepositoryError::unavailable)?;
        lock_enabled_user_for_update(&mut transaction, token.user_id).await?;

        let active_count = sqlx::query_scalar::<_, i64>(
            r#"
            SELECT count(*)
            FROM api_tokens
            WHERE user_id = $1
              AND revoked_at IS NULL
              AND expires_at > $2
            "#,
        )
        .bind(token.user_id)
        .bind(token.created_at)
        .fetch_one(&mut *transaction)
        .await
        .map_err(ApiTokensRepositoryError::unavailable)?;
        if active_count >= i64::from(active_token_limit) {
            return Err(ApiTokensRepositoryError::LimitReached);
        }

        let scopes = token
            .scopes
            .as_slice()
            .iter()
            .map(|scope| scope.as_str())
            .collect::<Vec<_>>();
        let row = sqlx::query_as::<_, ApiTokenRow>(
            r#"
            INSERT INTO api_tokens (
                id,
                user_id,
                name,
                display_prefix,
                token_hash,
                scopes,
                expires_at,
                created_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING
                id,
                user_id,
                name,
                display_prefix,
                scopes,
                expires_at,
                last_used_at,
                revoked_at,
                created_at
            "#,
        )
        .bind(token.id)
        .bind(token.user_id)
        .bind(token.name.as_str())
        .bind(token.display_prefix)
        .bind(token.token_digest.as_bytes().as_slice())
        .bind(scopes)
        .bind(token.expires_at)
        .bind(token.created_at)
        .fetch_one(&mut *transaction)
        .await
        .map_err(ApiTokensRepositoryError::unavailable)?;
        let created = row.try_into_token()?;
        record_token_audit(
            &mut transaction,
            created.user_id,
            created.id,
            "api_token.created",
            created.created_at,
        )
        .await?;
        transaction
            .commit()
            .await
            .map_err(ApiTokensRepositoryError::unavailable)?;
        Ok(created)
    }

    async fn list_tokens(
        &self,
        request: ListApiTokens,
    ) -> Result<Vec<ApiToken>, ApiTokensRepositoryError> {
        let mut transaction = self
            .pool
            .begin()
            .await
            .map_err(ApiTokensRepositoryError::unavailable)?;
        lock_enabled_user_for_share(&mut transaction, request.user_id).await?;
        let rows = sqlx::query_as::<_, ApiTokenRow>(
            r#"
            SELECT
                id,
                user_id,
                name,
                display_prefix,
                scopes,
                expires_at,
                last_used_at,
                revoked_at,
                created_at
            FROM api_tokens
            WHERE user_id = $1
            ORDER BY
                (revoked_at IS NULL AND expires_at > $2) DESC,
                created_at DESC,
                id DESC
            LIMIT $3
            "#,
        )
        .bind(request.user_id)
        .bind(request.now)
        .bind(i64::from(API_TOKEN_HISTORY_LIMIT))
        .fetch_all(&mut *transaction)
        .await
        .map_err(ApiTokensRepositoryError::unavailable)?;
        let tokens = rows
            .into_iter()
            .map(ApiTokenRow::try_into_token)
            .collect::<Result<Vec<_>, _>>()?;
        transaction
            .commit()
            .await
            .map_err(ApiTokensRepositoryError::unavailable)?;
        Ok(tokens)
    }

    async fn revoke_token(
        &self,
        request: RevokeApiToken,
    ) -> Result<ApiToken, ApiTokensRepositoryError> {
        let mut transaction = self
            .pool
            .begin()
            .await
            .map_err(ApiTokensRepositoryError::unavailable)?;
        lock_enabled_user_for_share(&mut transaction, request.user_id).await?;

        let changed = sqlx::query_as::<_, ApiTokenRow>(
            r#"
            UPDATE api_tokens
            SET revoked_at = GREATEST(
                $3,
                api_tokens.created_at,
                COALESCE(api_tokens.last_used_at, $3)
            )
            WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL
            RETURNING
                id,
                user_id,
                name,
                display_prefix,
                scopes,
                expires_at,
                last_used_at,
                revoked_at,
                created_at
            "#,
        )
        .bind(request.token_id)
        .bind(request.user_id)
        .bind(request.revoked_at)
        .fetch_optional(&mut *transaction)
        .await
        .map_err(ApiTokensRepositoryError::unavailable)?;

        let (row, transitioned) = if let Some(row) = changed {
            (row, true)
        } else {
            let row = sqlx::query_as::<_, ApiTokenRow>(
                r#"
                SELECT
                    id,
                    user_id,
                    name,
                    display_prefix,
                    scopes,
                    expires_at,
                    last_used_at,
                    revoked_at,
                    created_at
                FROM api_tokens
                WHERE id = $1 AND user_id = $2
                "#,
            )
            .bind(request.token_id)
            .bind(request.user_id)
            .fetch_optional(&mut *transaction)
            .await
            .map_err(ApiTokensRepositoryError::unavailable)?
            .ok_or(ApiTokensRepositoryError::NotFound)?;
            (row, false)
        };
        let revoked = row.try_into_token()?;
        if transitioned {
            let revoked_at = revoked.revoked_at.ok_or_else(corrupt_record)?;
            record_token_audit(
                &mut transaction,
                revoked.user_id,
                revoked.id,
                "api_token.revoked",
                revoked_at,
            )
            .await?;
        }
        transaction
            .commit()
            .await
            .map_err(ApiTokensRepositoryError::unavailable)?;
        Ok(revoked)
    }

    async fn resolve_token(
        &self,
        request: ResolveApiToken,
    ) -> Result<Option<ResolvedApiToken>, ApiTokensRepositoryError> {
        let row = sqlx::query_as::<_, ApiTokenRow>(
            r#"
            WITH candidate AS (
                SELECT api_tokens.id
                FROM api_tokens
                INNER JOIN users ON users.id = api_tokens.user_id
                WHERE api_tokens.token_hash = $1
                  AND api_tokens.created_at <= $2
                  AND api_tokens.expires_at > $2
                  AND api_tokens.revoked_at IS NULL
                  AND users.disabled_at IS NULL
                FOR UPDATE OF api_tokens
            ), touched AS (
                UPDATE api_tokens
                SET last_used_at = $2
                FROM candidate
                WHERE api_tokens.id = candidate.id
                  AND (
                      api_tokens.last_used_at IS NULL
                      OR api_tokens.last_used_at < $2 - make_interval(mins => $3)
                  )
                RETURNING
                    api_tokens.id,
                    api_tokens.user_id,
                    api_tokens.name,
                    api_tokens.display_prefix,
                    api_tokens.scopes,
                    api_tokens.expires_at,
                    api_tokens.last_used_at,
                    api_tokens.revoked_at,
                    api_tokens.created_at
            )
            SELECT * FROM touched
            UNION ALL
            SELECT
                api_tokens.id,
                api_tokens.user_id,
                api_tokens.name,
                api_tokens.display_prefix,
                api_tokens.scopes,
                api_tokens.expires_at,
                api_tokens.last_used_at,
                api_tokens.revoked_at,
                api_tokens.created_at
            FROM api_tokens
            INNER JOIN candidate ON candidate.id = api_tokens.id
            WHERE NOT EXISTS (SELECT 1 FROM touched)
            "#,
        )
        .bind(request.token_digest.as_bytes().as_slice())
        .bind(request.used_at)
        .bind(LAST_USED_WRITE_INTERVAL_MINUTES)
        .fetch_optional(&self.pool)
        .await
        .map_err(ApiTokensRepositoryError::unavailable)?;
        row.map(|row| {
            Ok(ResolvedApiToken {
                token: row.try_into_token()?,
                user_disabled_at: None,
            })
        })
        .transpose()
    }
}

async fn lock_enabled_user_for_update(
    transaction: &mut Transaction<'_, Postgres>,
    user_id: Uuid,
) -> Result<(), ApiTokensRepositoryError> {
    let disabled_at = sqlx::query_scalar::<_, Option<OffsetDateTime>>(
        "SELECT disabled_at FROM users WHERE id = $1 FOR UPDATE",
    )
    .bind(user_id)
    .fetch_optional(&mut **transaction)
    .await
    .map_err(ApiTokensRepositoryError::unavailable)?
    .ok_or(ApiTokensRepositoryError::AccountDisabled)?;
    if disabled_at.is_some() {
        return Err(ApiTokensRepositoryError::AccountDisabled);
    }
    Ok(())
}

async fn lock_enabled_user_for_share(
    transaction: &mut Transaction<'_, Postgres>,
    user_id: Uuid,
) -> Result<(), ApiTokensRepositoryError> {
    let disabled_at = sqlx::query_scalar::<_, Option<OffsetDateTime>>(
        "SELECT disabled_at FROM users WHERE id = $1 FOR SHARE",
    )
    .bind(user_id)
    .fetch_optional(&mut **transaction)
    .await
    .map_err(ApiTokensRepositoryError::unavailable)?
    .ok_or(ApiTokensRepositoryError::AccountDisabled)?;
    if disabled_at.is_some() {
        return Err(ApiTokensRepositoryError::AccountDisabled);
    }
    Ok(())
}

async fn record_token_audit(
    transaction: &mut Transaction<'_, Postgres>,
    user_id: Uuid,
    token_id: Uuid,
    action: &str,
    created_at: OffsetDateTime,
) -> Result<(), ApiTokensRepositoryError> {
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
            $3,
            'api_token',
            $2,
            '{}'::jsonb,
            $4
        FROM memberships
        INNER JOIN organizations ON organizations.id = memberships.organization_id
        WHERE memberships.user_id = $1 AND organizations.deleted_at IS NULL
        "#,
    )
    .bind(user_id)
    .bind(token_id)
    .bind(action)
    .bind(created_at)
    .execute(&mut **transaction)
    .await
    .map_err(ApiTokensRepositoryError::unavailable)?;
    Ok(())
}

#[cfg(test)]
mod tests;
