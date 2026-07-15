use thiserror::Error;

#[derive(Debug, Error, Clone, Copy, PartialEq, Eq)]
pub enum ProjectsError {
    #[error("project input is invalid")]
    InvalidInput,
    #[error("operation is forbidden")]
    Forbidden,
    #[error("project was not found")]
    NotFound,
    #[error("project slug already exists")]
    DuplicateSlug,
    #[error("projects infrastructure failed")]
    Infrastructure,
}

impl ProjectsError {
    pub const fn code(self) -> &'static str {
        match self {
            Self::InvalidInput => "INVALID_PROJECT_INPUT",
            Self::Forbidden => "FORBIDDEN",
            Self::NotFound => "PROJECT_NOT_FOUND",
            Self::DuplicateSlug => "DUPLICATE_PROJECT_SLUG",
            Self::Infrastructure => "PROJECTS_INFRASTRUCTURE_FAILURE",
        }
    }
}
