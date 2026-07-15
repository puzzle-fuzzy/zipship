use thiserror::Error;

#[derive(Debug, Error, Clone, Copy, PartialEq, Eq)]
pub enum InvitationsError {
    #[error("invitation email is invalid")]
    InvalidEmail,
    #[error("invitation role is invalid")]
    InvalidRole,
    #[error("operation is forbidden")]
    Forbidden,
    #[error("the email already belongs to an organization member")]
    AlreadyMember,
    #[error("an active invitation already exists")]
    Pending,
    #[error("invitation was not found")]
    NotFound,
    #[error("invitation has expired")]
    Expired,
    #[error("invitation belongs to another email address")]
    WrongRecipient,
    #[error("invitations infrastructure failed")]
    Infrastructure,
}

impl InvitationsError {
    pub const fn code(self) -> &'static str {
        match self {
            Self::InvalidEmail => "INVALID_EMAIL",
            Self::InvalidRole => "INVALID_MEMBER_ROLE",
            Self::Forbidden => "FORBIDDEN",
            Self::AlreadyMember => "ALREADY_MEMBER",
            Self::Pending => "INVITATION_PENDING",
            Self::NotFound => "INVITATION_NOT_FOUND",
            Self::Expired => "INVITATION_EXPIRED",
            Self::WrongRecipient => "INVITATION_WRONG_RECIPIENT",
            Self::Infrastructure => "INVITATIONS_INFRASTRUCTURE_FAILURE",
        }
    }
}
