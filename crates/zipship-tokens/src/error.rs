use thiserror::Error;

#[derive(Debug, Error, Clone, Copy, PartialEq, Eq)]
pub enum ApiTokensError {
    #[error("api token name is invalid")]
    InvalidName,
    #[error("api token scopes are invalid")]
    InvalidScopes,
    #[error("api token expiration is invalid")]
    InvalidExpiration,
    #[error("the user has reached the active api token limit")]
    LimitReached,
    #[error("api token was not found")]
    NotFound,
    #[error("api token authentication failed")]
    Unauthenticated,
    #[error("api token infrastructure failed")]
    Infrastructure,
}

impl ApiTokensError {
    pub const fn code(self) -> &'static str {
        match self {
            Self::InvalidName => "INVALID_API_TOKEN_NAME",
            Self::InvalidScopes => "INVALID_API_TOKEN_SCOPES",
            Self::InvalidExpiration => "INVALID_API_TOKEN_EXPIRATION",
            Self::LimitReached => "API_TOKEN_LIMIT_REACHED",
            Self::NotFound => "API_TOKEN_NOT_FOUND",
            Self::Unauthenticated => "UNAUTHENTICATED",
            Self::Infrastructure => "API_TOKENS_INFRASTRUCTURE_FAILURE",
        }
    }
}
