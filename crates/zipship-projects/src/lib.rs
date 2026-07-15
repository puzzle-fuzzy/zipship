#![forbid(unsafe_code)]

use async_trait::async_trait;
use std::{error::Error as StdError, str::FromStr, sync::Arc};
use thiserror::Error;
use time::OffsetDateTime;
use uuid::Uuid;
use zipship_domain::{
    CachePolicy, MemberRole, PermissionAction, ProjectDescription, ProjectName, ProjectSlug,
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OrganizationSummary {
    pub id: Uuid,
    pub name: String,
    pub slug: String,
    pub role: MemberRole,
    pub created_at: OffsetDateTime,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Project {
    pub id: Uuid,
    pub organization_id: Uuid,
    pub name: String,
    pub slug: String,
    pub description: Option<String>,
    pub spa_fallback: bool,
    pub cache_policy: CachePolicy,
    pub active_release_id: Option<Uuid>,
    pub created_by: Uuid,
    pub created_at: OffsetDateTime,
    pub updated_at: OffsetDateTime,
}

#[derive(Debug, Clone)]
pub struct ProjectAccess {
    pub project: Project,
    pub role: MemberRole,
}

#[derive(Debug, Clone)]
pub struct NewProject {
    pub id: Uuid,
    pub organization_id: Uuid,
    pub name: ProjectName,
    pub slug: ProjectSlug,
    pub description: ProjectDescription,
    pub created_by: Uuid,
    pub created_at: OffsetDateTime,
}

#[derive(Debug)]
pub struct CreateProjectCommand {
    pub actor_id: Uuid,
    pub organization_id: Uuid,
    pub name: String,
    pub slug: String,
    pub description: Option<String>,
}

#[derive(Debug)]
pub struct UpdateProject {
    pub actor_id: Uuid,
    pub project_id: Uuid,
    pub name: Option<ProjectName>,
    pub slug: Option<ProjectSlug>,
    pub description: Option<ProjectDescription>,
    pub spa_fallback: Option<bool>,
    pub cache_policy: Option<CachePolicy>,
    pub updated_at: OffsetDateTime,
}

#[derive(Debug)]
pub struct UpdateProjectCommand {
    pub actor_id: Uuid,
    pub project_id: Uuid,
    pub name: Option<String>,
    pub slug: Option<String>,
    pub description: Option<Option<String>>,
    pub spa_fallback: Option<bool>,
    pub cache_policy: Option<String>,
}

#[derive(Debug, Error)]
pub enum ProjectsRepositoryError {
    #[error("project slug already exists")]
    DuplicateSlug,
    #[error("project was not found or is not visible")]
    NotFound,
    #[error("membership no longer authorizes this operation")]
    Forbidden,
    #[error("projects repository is unavailable")]
    Unavailable {
        #[source]
        source: Box<dyn StdError + Send + Sync>,
    },
}

impl ProjectsRepositoryError {
    pub fn unavailable(source: impl StdError + Send + Sync + 'static) -> Self {
        Self::Unavailable {
            source: Box::new(source),
        }
    }
}

#[async_trait]
pub trait ProjectsRepository: Send + Sync + 'static {
    async fn list_organizations(
        &self,
        actor_id: Uuid,
    ) -> Result<Vec<OrganizationSummary>, ProjectsRepositoryError>;

    async fn membership_role(
        &self,
        organization_id: Uuid,
        actor_id: Uuid,
    ) -> Result<Option<MemberRole>, ProjectsRepositoryError>;

    async fn create_project(&self, project: NewProject)
    -> Result<Project, ProjectsRepositoryError>;

    async fn update_project(
        &self,
        project: UpdateProject,
    ) -> Result<Project, ProjectsRepositoryError>;

    async fn list_projects(
        &self,
        organization_id: Uuid,
        actor_id: Uuid,
    ) -> Result<Vec<Project>, ProjectsRepositoryError>;

    async fn find_project_for_member(
        &self,
        project_id: Uuid,
        actor_id: Uuid,
    ) -> Result<Option<ProjectAccess>, ProjectsRepositoryError>;
}

pub trait Clock: Send + Sync + 'static {
    fn now(&self) -> OffsetDateTime;
}

#[derive(Debug, Default)]
pub struct SystemClock;

impl Clock for SystemClock {
    fn now(&self) -> OffsetDateTime {
        OffsetDateTime::now_utc()
    }
}

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

#[derive(Clone)]
pub struct ProjectsService {
    repository: Arc<dyn ProjectsRepository>,
    clock: Arc<dyn Clock>,
}

impl ProjectsService {
    pub fn new(repository: Arc<dyn ProjectsRepository>) -> Self {
        Self::with_clock(repository, Arc::new(SystemClock))
    }

    pub fn with_clock(repository: Arc<dyn ProjectsRepository>, clock: Arc<dyn Clock>) -> Self {
        Self { repository, clock }
    }

    pub async fn list_organizations(
        &self,
        actor_id: Uuid,
    ) -> Result<Vec<OrganizationSummary>, ProjectsError> {
        self.repository
            .list_organizations(actor_id)
            .await
            .map_err(map_repository_error)
    }

    pub async fn create_project(
        &self,
        command: CreateProjectCommand,
    ) -> Result<Project, ProjectsError> {
        self.require_permission(
            command.organization_id,
            command.actor_id,
            PermissionAction::CreateProject,
        )
        .await?;

        let name = ProjectName::parse(&command.name).map_err(|_| ProjectsError::InvalidInput)?;
        let slug = ProjectSlug::parse_normalized(&command.slug)
            .map_err(|_| ProjectsError::InvalidInput)?;
        let description = ProjectDescription::parse(command.description.as_deref())
            .map_err(|_| ProjectsError::InvalidInput)?;
        let now = self.clock.now();
        self.repository
            .create_project(NewProject {
                id: Uuid::new_v4(),
                organization_id: command.organization_id,
                name,
                slug,
                description,
                created_by: command.actor_id,
                created_at: now,
            })
            .await
            .map_err(map_repository_error)
    }

    pub async fn list_projects(
        &self,
        actor_id: Uuid,
        organization_id: Uuid,
    ) -> Result<Vec<Project>, ProjectsError> {
        self.require_permission(organization_id, actor_id, PermissionAction::ViewProject)
            .await?;
        self.repository
            .list_projects(organization_id, actor_id)
            .await
            .map_err(map_repository_error)
    }

    pub async fn update_project(
        &self,
        command: UpdateProjectCommand,
    ) -> Result<Project, ProjectsError> {
        if command.name.is_none()
            && command.slug.is_none()
            && command.description.is_none()
            && command.spa_fallback.is_none()
            && command.cache_policy.is_none()
        {
            return Err(ProjectsError::InvalidInput);
        }
        let name = command
            .name
            .map(ProjectName::parse)
            .transpose()
            .map_err(|_| ProjectsError::InvalidInput)?;
        let slug = command
            .slug
            .map(ProjectSlug::parse_normalized)
            .transpose()
            .map_err(|_| ProjectsError::InvalidInput)?;
        let description = command
            .description
            .map(|description| ProjectDescription::parse(description.as_deref()))
            .transpose()
            .map_err(|_| ProjectsError::InvalidInput)?;
        let cache_policy = command
            .cache_policy
            .map(|policy| CachePolicy::from_str(&policy))
            .transpose()
            .map_err(|_| ProjectsError::InvalidInput)?;
        self.repository
            .update_project(UpdateProject {
                actor_id: command.actor_id,
                project_id: command.project_id,
                name,
                slug,
                description,
                spa_fallback: command.spa_fallback,
                cache_policy,
                updated_at: self.clock.now(),
            })
            .await
            .map_err(map_repository_error)
    }

    pub async fn get_project(
        &self,
        actor_id: Uuid,
        project_id: Uuid,
    ) -> Result<Project, ProjectsError> {
        let access = self
            .repository
            .find_project_for_member(project_id, actor_id)
            .await
            .map_err(map_repository_error)?
            .ok_or(ProjectsError::NotFound)?;
        if !access.role.can(PermissionAction::ViewProject) {
            return Err(ProjectsError::NotFound);
        }
        Ok(access.project)
    }

    async fn require_permission(
        &self,
        organization_id: Uuid,
        actor_id: Uuid,
        action: PermissionAction,
    ) -> Result<MemberRole, ProjectsError> {
        let role = self
            .repository
            .membership_role(organization_id, actor_id)
            .await
            .map_err(map_repository_error)?
            .ok_or(ProjectsError::Forbidden)?;
        role.can(action)
            .then_some(role)
            .ok_or(ProjectsError::Forbidden)
    }
}

fn map_repository_error(error: ProjectsRepositoryError) -> ProjectsError {
    match error {
        ProjectsRepositoryError::DuplicateSlug => ProjectsError::DuplicateSlug,
        ProjectsRepositoryError::NotFound => ProjectsError::NotFound,
        ProjectsRepositoryError::Forbidden => ProjectsError::Forbidden,
        ProjectsRepositoryError::Unavailable { .. } => ProjectsError::Infrastructure,
    }
}

#[cfg(test)]
mod tests;
