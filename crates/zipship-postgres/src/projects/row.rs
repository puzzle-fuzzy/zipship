use sqlx::FromRow;
use std::str::FromStr;
use thiserror::Error;
use time::OffsetDateTime;
use uuid::Uuid;
use zipship_domain::{CachePolicy, MemberRole};
use zipship_projects::{OrganizationSummary, Project, ProjectAccess, ProjectsRepositoryError};

pub(super) fn parse_role(value: &str) -> Result<MemberRole, ProjectsRepositoryError> {
    MemberRole::from_str(value).map_err(|_| corrupt_record("memberships.role"))
}

pub(super) fn parse_cache_policy(value: &str) -> Result<CachePolicy, ProjectsRepositoryError> {
    CachePolicy::from_str(value).map_err(|_| corrupt_record("projects.cache_policy"))
}

#[derive(Debug, FromRow)]
pub(super) struct OrganizationRow {
    id: Uuid,
    name: String,
    slug: String,
    role: String,
    created_at: OffsetDateTime,
}

impl TryFrom<OrganizationRow> for OrganizationSummary {
    type Error = ProjectsRepositoryError;

    fn try_from(row: OrganizationRow) -> Result<Self, Self::Error> {
        Ok(Self {
            id: row.id,
            name: row.name,
            slug: row.slug,
            role: parse_role(&row.role)?,
            created_at: row.created_at,
        })
    }
}

#[derive(Debug, FromRow)]
pub(super) struct ProjectRow {
    id: Uuid,
    organization_id: Uuid,
    name: String,
    slug: String,
    description: Option<String>,
    spa_fallback: bool,
    cache_policy: String,
    active_release_id: Option<Uuid>,
    created_by: Uuid,
    created_at: OffsetDateTime,
    updated_at: OffsetDateTime,
}

impl TryFrom<ProjectRow> for Project {
    type Error = ProjectsRepositoryError;

    fn try_from(row: ProjectRow) -> Result<Self, Self::Error> {
        Ok(Self {
            id: row.id,
            organization_id: row.organization_id,
            name: row.name,
            slug: row.slug,
            description: row.description,
            spa_fallback: row.spa_fallback,
            cache_policy: parse_cache_policy(&row.cache_policy)?,
            active_release_id: row.active_release_id,
            created_by: row.created_by,
            created_at: row.created_at,
            updated_at: row.updated_at,
        })
    }
}

#[derive(Debug, FromRow)]
pub(super) struct ProjectAccessRow {
    id: Uuid,
    organization_id: Uuid,
    name: String,
    slug: String,
    description: Option<String>,
    spa_fallback: bool,
    cache_policy: String,
    active_release_id: Option<Uuid>,
    created_by: Uuid,
    created_at: OffsetDateTime,
    updated_at: OffsetDateTime,
    role: String,
}

impl TryFrom<ProjectAccessRow> for ProjectAccess {
    type Error = ProjectsRepositoryError;

    fn try_from(row: ProjectAccessRow) -> Result<Self, Self::Error> {
        let role = parse_role(&row.role)?;
        let project = ProjectRow {
            id: row.id,
            organization_id: row.organization_id,
            name: row.name,
            slug: row.slug,
            description: row.description,
            spa_fallback: row.spa_fallback,
            cache_policy: row.cache_policy,
            active_release_id: row.active_release_id,
            created_by: row.created_by,
            created_at: row.created_at,
            updated_at: row.updated_at,
        }
        .try_into()?;
        Ok(Self { project, role })
    }
}

#[derive(Debug, Error)]
#[error("database contains an invalid project value in {field}")]
struct CorruptProjectRecord {
    field: &'static str,
}

fn corrupt_record(field: &'static str) -> ProjectsRepositoryError {
    ProjectsRepositoryError::unavailable(CorruptProjectRecord { field })
}
