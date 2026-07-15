use thiserror::Error;

#[derive(Debug, Error, Clone, Copy, PartialEq, Eq)]
pub enum MembersError {
    #[error("member role is invalid")]
    InvalidRole,
    #[error("operation is forbidden")]
    Forbidden,
    #[error("member was not found")]
    NotFound,
    #[error("an organization must retain at least one owner")]
    LastOwner,
    #[error("members infrastructure failed")]
    Infrastructure,
}

impl MembersError {
    pub const fn code(self) -> &'static str {
        match self {
            Self::InvalidRole => "INVALID_MEMBER_ROLE",
            Self::Forbidden => "FORBIDDEN",
            Self::NotFound => "MEMBER_NOT_FOUND",
            Self::LastOwner => "LAST_OWNER",
            Self::Infrastructure => "MEMBERS_INFRASTRUCTURE_FAILURE",
        }
    }
}
