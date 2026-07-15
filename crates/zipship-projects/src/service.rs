use crate::{
    error::ProjectsError,
    model::{
        CreateProjectCommand, NewProject, OrganizationSummary, Project, UpdateProject,
        UpdateProjectCommand,
    },
    repository::{Clock, ProjectsRepository, ProjectsRepositoryError, SystemClock},
};
use std::{str::FromStr, sync::Arc};
use uuid::Uuid;
use zipship_domain::{
    CachePolicy, MemberRole, PermissionAction, ProjectDescription, ProjectName, ProjectSlug,
};

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
