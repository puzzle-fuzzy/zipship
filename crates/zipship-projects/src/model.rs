use time::OffsetDateTime;
use uuid::Uuid;
use zipship_domain::{CachePolicy, MemberRole, ProjectDescription, ProjectName, ProjectSlug};

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
