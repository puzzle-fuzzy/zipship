use crate::model::{NewProject, OrganizationSummary, Project, ProjectAccess, UpdateProject};
use async_trait::async_trait;
use std::error::Error as StdError;
use thiserror::Error;
use time::OffsetDateTime;
use uuid::Uuid;
use zipship_domain::MemberRole;

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
