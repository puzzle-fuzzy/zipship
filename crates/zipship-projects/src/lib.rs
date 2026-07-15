#![forbid(unsafe_code)]

use async_trait::async_trait;
use std::{error::Error as StdError, sync::Arc};
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
pub struct MemberSummary {
    pub user_id: Uuid,
    pub email: String,
    pub display_name: String,
    pub role: MemberRole,
    pub joined_at: OffsetDateTime,
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

#[derive(Debug, Error)]
pub enum ProjectsRepositoryError {
    #[error("project slug already exists")]
    DuplicateSlug,
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

    async fn list_members(
        &self,
        organization_id: Uuid,
        actor_id: Uuid,
    ) -> Result<Vec<MemberSummary>, ProjectsRepositoryError>;

    async fn create_project(&self, project: NewProject)
    -> Result<Project, ProjectsRepositoryError>;

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

    pub async fn list_members(
        &self,
        actor_id: Uuid,
        organization_id: Uuid,
    ) -> Result<Vec<MemberSummary>, ProjectsError> {
        self.require_permission(
            organization_id,
            actor_id,
            PermissionAction::ViewOrganization,
        )
        .await?;
        self.repository
            .list_members(organization_id, actor_id)
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
        ProjectsRepositoryError::Forbidden => ProjectsError::Forbidden,
        ProjectsRepositoryError::Unavailable { .. } => ProjectsError::Infrastructure,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    const NOW: OffsetDateTime = OffsetDateTime::UNIX_EPOCH;

    #[derive(Clone)]
    struct Membership {
        organization_id: Uuid,
        user_id: Uuid,
        role: MemberRole,
    }

    #[derive(Default)]
    struct State {
        organizations: Vec<OrganizationSummary>,
        memberships: Vec<Membership>,
        members: Vec<MemberSummary>,
        projects: Vec<Project>,
    }

    #[derive(Default)]
    struct InMemoryRepository {
        state: Mutex<State>,
    }

    #[async_trait]
    impl ProjectsRepository for InMemoryRepository {
        async fn list_organizations(
            &self,
            actor_id: Uuid,
        ) -> Result<Vec<OrganizationSummary>, ProjectsRepositoryError> {
            let state = self.state.lock().unwrap();
            Ok(state
                .organizations
                .iter()
                .filter(|organization| {
                    state.memberships.iter().any(|membership| {
                        membership.organization_id == organization.id
                            && membership.user_id == actor_id
                    })
                })
                .cloned()
                .collect())
        }

        async fn membership_role(
            &self,
            organization_id: Uuid,
            actor_id: Uuid,
        ) -> Result<Option<MemberRole>, ProjectsRepositoryError> {
            Ok(self
                .state
                .lock()
                .unwrap()
                .memberships
                .iter()
                .find(|membership| {
                    membership.organization_id == organization_id && membership.user_id == actor_id
                })
                .map(|membership| membership.role))
        }

        async fn list_members(
            &self,
            organization_id: Uuid,
            actor_id: Uuid,
        ) -> Result<Vec<MemberSummary>, ProjectsRepositoryError> {
            let state = self.state.lock().unwrap();
            let authorized = state.memberships.iter().any(|membership| {
                membership.organization_id == organization_id && membership.user_id == actor_id
            });
            if !authorized {
                return Err(ProjectsRepositoryError::Forbidden);
            }
            Ok(state.members.clone())
        }

        async fn create_project(
            &self,
            project: NewProject,
        ) -> Result<Project, ProjectsRepositoryError> {
            let mut state = self.state.lock().unwrap();
            let authorized = state.memberships.iter().any(|membership| {
                membership.organization_id == project.organization_id
                    && membership.user_id == project.created_by
                    && membership.role.can(PermissionAction::CreateProject)
            });
            if !authorized {
                return Err(ProjectsRepositoryError::Forbidden);
            }
            if state
                .projects
                .iter()
                .any(|stored| stored.slug == project.slug.as_str())
            {
                return Err(ProjectsRepositoryError::DuplicateSlug);
            }
            let project = Project {
                id: project.id,
                organization_id: project.organization_id,
                name: project.name.as_str().to_owned(),
                slug: project.slug.as_str().to_owned(),
                description: project.description.into_inner(),
                spa_fallback: true,
                cache_policy: CachePolicy::Standard,
                active_release_id: None,
                created_by: project.created_by,
                created_at: project.created_at,
                updated_at: project.created_at,
            };
            state.projects.push(project.clone());
            Ok(project)
        }

        async fn list_projects(
            &self,
            organization_id: Uuid,
            actor_id: Uuid,
        ) -> Result<Vec<Project>, ProjectsRepositoryError> {
            let state = self.state.lock().unwrap();
            if !state.memberships.iter().any(|membership| {
                membership.organization_id == organization_id && membership.user_id == actor_id
            }) {
                return Err(ProjectsRepositoryError::Forbidden);
            }
            Ok(state
                .projects
                .iter()
                .filter(|project| project.organization_id == organization_id)
                .cloned()
                .collect())
        }

        async fn find_project_for_member(
            &self,
            project_id: Uuid,
            actor_id: Uuid,
        ) -> Result<Option<ProjectAccess>, ProjectsRepositoryError> {
            let state = self.state.lock().unwrap();
            let Some(project) = state
                .projects
                .iter()
                .find(|project| project.id == project_id)
            else {
                return Ok(None);
            };
            Ok(state
                .memberships
                .iter()
                .find(|membership| {
                    membership.organization_id == project.organization_id
                        && membership.user_id == actor_id
                })
                .map(|membership| ProjectAccess {
                    project: project.clone(),
                    role: membership.role,
                }))
        }
    }

    struct FixedClock;

    impl Clock for FixedClock {
        fn now(&self) -> OffsetDateTime {
            NOW
        }
    }

    fn fixture(role: MemberRole) -> (Arc<InMemoryRepository>, ProjectsService, Uuid, Uuid) {
        let user_id = Uuid::new_v4();
        let organization_id = Uuid::new_v4();
        let repository = Arc::new(InMemoryRepository::default());
        {
            let mut state = repository.state.lock().unwrap();
            state.organizations.push(OrganizationSummary {
                id: organization_id,
                name: "Puzzle Fuzzy".to_owned(),
                slug: "puzzle-fuzzy".to_owned(),
                role,
                created_at: NOW,
            });
            state.memberships.push(Membership {
                organization_id,
                user_id,
                role,
            });
            state.members.push(MemberSummary {
                user_id,
                email: "owner@example.com".to_owned(),
                display_name: "Owner".to_owned(),
                role,
                joined_at: NOW,
            });
        }
        let service = ProjectsService::with_clock(repository.clone(), Arc::new(FixedClock));
        (repository, service, user_id, organization_id)
    }

    fn create_command(actor_id: Uuid, organization_id: Uuid) -> CreateProjectCommand {
        CreateProjectCommand {
            actor_id,
            organization_id,
            name: "  Marketing Site  ".to_owned(),
            slug: " Marketing-Site ".to_owned(),
            description: Some("  Campaign frontend  ".to_owned()),
        }
    }

    #[tokio::test]
    async fn lists_only_the_current_users_organizations_and_members() {
        let (_, service, user_id, organization_id) = fixture(MemberRole::Viewer);
        let organizations = service.list_organizations(user_id).await.unwrap();
        assert_eq!(organizations.len(), 1);
        assert_eq!(organizations[0].role, MemberRole::Viewer);
        let members = service
            .list_members(user_id, organization_id)
            .await
            .unwrap();
        assert_eq!(members.len(), 1);
    }

    #[tokio::test]
    async fn developers_create_normalized_projects() {
        let (_, service, user_id, organization_id) = fixture(MemberRole::Developer);
        let project = service
            .create_project(create_command(user_id, organization_id))
            .await
            .unwrap();
        assert_eq!(project.name, "Marketing Site");
        assert_eq!(project.slug, "marketing-site");
        assert_eq!(project.description.as_deref(), Some("Campaign frontend"));
        assert_eq!(project.created_at, NOW);
    }

    #[tokio::test]
    async fn viewers_cannot_create_projects() {
        let (_, service, user_id, organization_id) = fixture(MemberRole::Viewer);
        assert_eq!(
            service
                .create_project(create_command(user_id, organization_id))
                .await,
            Err(ProjectsError::Forbidden),
        );
    }

    #[tokio::test]
    async fn duplicate_slugs_have_a_stable_error() {
        let (_, service, user_id, organization_id) = fixture(MemberRole::Owner);
        service
            .create_project(create_command(user_id, organization_id))
            .await
            .unwrap();
        let error = service
            .create_project(create_command(user_id, organization_id))
            .await
            .unwrap_err();
        assert_eq!(error, ProjectsError::DuplicateSlug);
        assert_eq!(error.code(), "DUPLICATE_PROJECT_SLUG");
    }

    #[tokio::test]
    async fn non_members_cannot_enumerate_projects() {
        let (_, service, user_id, organization_id) = fixture(MemberRole::Owner);
        let project = service
            .create_project(create_command(user_id, organization_id))
            .await
            .unwrap();
        assert_eq!(
            service.get_project(Uuid::new_v4(), project.id).await,
            Err(ProjectsError::NotFound),
        );
    }
}
