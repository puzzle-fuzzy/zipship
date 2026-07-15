use super::*;

#[derive(Default)]
pub(super) struct TestApiTokensRepository {
    tokens: Mutex<Vec<(ApiToken, TokenDigest)>>,
}

#[async_trait]
impl ApiTokensRepository for TestApiTokensRepository {
    async fn create_token(
        &self,
        token: NewApiToken,
        active_token_limit: u16,
    ) -> Result<ApiToken, ApiTokensRepositoryError> {
        let mut tokens = self.tokens.lock().unwrap();
        let active_count = tokens
            .iter()
            .filter(|(stored, _)| {
                stored.user_id == token.user_id
                    && stored.state_at(token.created_at) == ApiTokenState::Active
            })
            .count();
        if active_count >= usize::from(active_token_limit) {
            return Err(ApiTokensRepositoryError::LimitReached);
        }
        let stored = ApiToken {
            id: token.id,
            user_id: token.user_id,
            name: token.name.as_str().to_owned(),
            display_prefix: token.display_prefix,
            scopes: token.scopes.as_slice().to_vec(),
            expires_at: token.expires_at,
            last_used_at: None,
            revoked_at: None,
            created_at: token.created_at,
        };
        tokens.push((stored.clone(), token.token_digest));
        Ok(stored)
    }

    async fn list_tokens(
        &self,
        request: ListApiTokens,
    ) -> Result<Vec<ApiToken>, ApiTokensRepositoryError> {
        let mut tokens = self
            .tokens
            .lock()
            .unwrap()
            .iter()
            .filter(|(token, _)| token.user_id == request.user_id)
            .map(|(token, _)| token.clone())
            .collect::<Vec<_>>();
        tokens.sort_by_key(|token| {
            (
                token.state_at(request.now) != ApiTokenState::Active,
                std::cmp::Reverse(token.created_at),
            )
        });
        Ok(tokens)
    }

    async fn revoke_token(
        &self,
        request: RevokeApiToken,
    ) -> Result<ApiToken, ApiTokensRepositoryError> {
        let mut tokens = self.tokens.lock().unwrap();
        let token = tokens
            .iter_mut()
            .find(|(token, _)| token.id == request.token_id && token.user_id == request.user_id)
            .map(|(token, _)| token)
            .ok_or(ApiTokensRepositoryError::NotFound)?;
        token.revoked_at.get_or_insert(request.revoked_at);
        Ok(token.clone())
    }

    async fn resolve_token(
        &self,
        request: ResolveApiToken,
    ) -> Result<Option<ResolvedApiToken>, ApiTokensRepositoryError> {
        let mut tokens = self.tokens.lock().unwrap();
        let Some(token) = tokens
            .iter_mut()
            .find(|(token, digest)| {
                *digest == request.token_digest
                    && token.state_at(request.used_at) == ApiTokenState::Active
            })
            .map(|(token, _)| token)
        else {
            return Ok(None);
        };
        token.last_used_at = Some(request.used_at);
        Ok(Some(ResolvedApiToken {
            token: token.clone(),
            user_disabled_at: None,
        }))
    }
}
