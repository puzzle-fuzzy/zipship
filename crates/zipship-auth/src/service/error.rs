use thiserror::Error;

#[derive(Debug, Error, Clone, Copy, PartialEq, Eq)]
pub enum AuthError {
    #[error("invalid email")]
    InvalidEmail,
    #[error("invalid display name")]
    InvalidDisplayName,
    #[error("password does not satisfy the policy")]
    InvalidPassword,
    #[error("email already exists")]
    DuplicateEmail,
    #[error("invalid credentials")]
    InvalidCredentials,
    #[error("account is disabled")]
    AccountDisabled,
    #[error("authentication is required")]
    Unauthenticated,
    #[error("csrf token is invalid")]
    InvalidCsrfToken,
    #[error("authentication infrastructure failed")]
    Infrastructure,
}

impl AuthError {
    pub const fn code(self) -> &'static str {
        match self {
            Self::InvalidEmail => "INVALID_EMAIL",
            Self::InvalidDisplayName => "INVALID_DISPLAY_NAME",
            Self::InvalidPassword => "INVALID_PASSWORD",
            Self::DuplicateEmail => "DUPLICATE_EMAIL",
            Self::InvalidCredentials => "INVALID_CREDENTIALS",
            Self::AccountDisabled => "ACCOUNT_DISABLED",
            Self::Unauthenticated => "UNAUTHENTICATED",
            Self::InvalidCsrfToken => "INVALID_CSRF_TOKEN",
            Self::Infrastructure => "AUTH_INFRASTRUCTURE_FAILURE",
        }
    }
}
