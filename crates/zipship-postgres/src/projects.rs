use async_trait::async_trait;
use serde_json::json;
use sqlx::{FromRow, PgPool};
use std::str::FromStr;
use thiserror::Error;
use time::OffsetDateTime;
use uuid::Uuid;
use zipship_domain::{CachePolicy, MemberRole, PermissionAction};
use zipship_projects::{
    MemberSummary, NewProject, OrganizationSummary, Project, ProjectAccess, ProjectsRepository,
    ProjectsRepositoryError, UpdateProject,
};

#[derive(Debug, Clone)]
pub struct PgProjectsRepository {
    pool: PgPool,
}

impl PgProjectsRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl ProjectsRepository for PgProjectsRepository {
    async fn list_organizations(
        &self,
        actor_id: Uuid,
    ) -> Result<Vec<OrganizationSummary>, ProjectsRepositoryError> {
        let rows = sqlx::query_as::<_, OrganizationRow>(
            r#"
            SELECT
                organizations.id,
                organizations.name,
                organizations.slug,
                memberships.role,
                organizations.created_at
            FROM memberships
            INNER JOIN organizations ON organizations.id = memberships.organization_id
            WHERE memberships.user_id = $1
              AND organizations.deleted_at IS NULL
            ORDER BY organizations.created_at ASC, organizations.id ASC
            "#,
        )
        .bind(actor_id)
        .fetch_all(&self.pool)
        .await
        .map_err(ProjectsRepositoryError::unavailable)?;
        rows.into_iter().map(TryInto::try_into).collect()
    }

    async fn membership_role(
        &self,
        organization_id: Uuid,
        actor_id: Uuid,
    ) -> Result<Option<MemberRole>, ProjectsRepositoryError> {
        let role = sqlx::query_scalar::<_, String>(
            r#"
            SELECT memberships.role
            FROM memberships
            INNER JOIN organizations ON organizations.id = memberships.organization_id
            WHERE memberships.organization_id = $1
              AND memberships.user_id = $2
              AND organizations.deleted_at IS NULL
            "#,
        )
        .bind(organization_id)
        .bind(actor_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(ProjectsRepositoryError::unavailable)?;
        role.map(|role| parse_role(&role)).transpose()
    }

    async fn list_members(
        &self,
        organization_id: Uuid,
        actor_id: Uuid,
    ) -> Result<Vec<MemberSummary>, ProjectsRepositoryError> {
        let rows = sqlx::query_as::<_, MemberRow>(
            r#"
            SELECT
                users.id AS user_id,
                users.email,
                users.display_name,
                target_membership.role,
                target_membership.created_at AS joined_at
            FROM memberships AS target_membership
            INNER JOIN users ON users.id = target_membership.user_id
            WHERE target_membership.organization_id = $1
              AND EXISTS (
                  SELECT 1
                  FROM memberships AS actor_membership
                  WHERE actor_membership.organization_id = $1
                    AND actor_membership.user_id = $2
              )
            ORDER BY target_membership.created_at ASC, users.id ASC
            "#,
        )
        .bind(organization_id)
        .bind(actor_id)
        .fetch_all(&self.pool)
        .await
        .map_err(ProjectsRepositoryError::unavailable)?;
        if rows.is_empty()
            && self
                .membership_role(organization_id, actor_id)
                .await?
                .is_none()
        {
            return Err(ProjectsRepositoryError::Forbidden);
        }
        rows.into_iter().map(TryInto::try_into).collect()
    }

    async fn create_project(
        &self,
        project: NewProject,
    ) -> Result<Project, ProjectsRepositoryError> {
        let mut transaction = self
            .pool
            .begin()
            .await
            .map_err(ProjectsRepositoryError::unavailable)?;
        let row = sqlx::query_as::<_, ProjectRow>(
            r#"
            INSERT INTO projects (
                id,
                organization_id,
                name,
                slug,
                description,
                created_by,
                created_at,
                updated_at
            )
            SELECT $1, $2, $3, $4, $5, $6, $7, $7
            WHERE EXISTS (
                SELECT 1
                FROM memberships
                WHERE organization_id = $2
                  AND user_id = $6
                  AND role IN ('owner', 'admin', 'developer')
            )
            RETURNING
                id,
                organization_id,
                name,
                slug,
                description,
                spa_fallback,
                cache_policy,
                NULL::uuid AS active_release_id,
                created_by,
                created_at,
                updated_at
            "#,
        )
        .bind(project.id)
        .bind(project.organization_id)
        .bind(project.name.as_str())
        .bind(project.slug.as_str())
        .bind(project.description.as_deref())
        .bind(project.created_by)
        .bind(project.created_at)
        .fetch_optional(&mut *transaction)
        .await
        .map_err(map_project_write_error)?
        .ok_or(ProjectsRepositoryError::Forbidden)?;

        sqlx::query(
            r#"
            INSERT INTO audit_logs (
                organization_id,
                project_id,
                actor_id,
                action,
                target_type,
                target_id,
                metadata,
                created_at
            )
            VALUES ($1, $2, $3, 'project.created', 'project', $2, '{}'::jsonb, $4)
            "#,
        )
        .bind(project.organization_id)
        .bind(project.id)
        .bind(project.created_by)
        .bind(project.created_at)
        .execute(&mut *transaction)
        .await
        .map_err(ProjectsRepositoryError::unavailable)?;

        transaction
            .commit()
            .await
            .map_err(ProjectsRepositoryError::unavailable)?;
        row.try_into()
    }

    async fn update_project(
        &self,
        update: UpdateProject,
    ) -> Result<Project, ProjectsRepositoryError> {
        let mut transaction = self
            .pool
            .begin()
            .await
            .map_err(ProjectsRepositoryError::unavailable)?;
        let row = sqlx::query_as::<_, ProjectAccessRow>(
            r#"
            SELECT
                projects.id,
                projects.organization_id,
                projects.name,
                projects.slug,
                projects.description,
                projects.spa_fallback,
                projects.cache_policy,
                project_active_releases.release_id AS active_release_id,
                projects.created_by,
                projects.created_at,
                projects.updated_at,
                memberships.role
            FROM projects
            INNER JOIN memberships
                ON memberships.organization_id = projects.organization_id
               AND memberships.user_id = $2
            LEFT JOIN project_active_releases
                ON project_active_releases.project_id = projects.id
            WHERE projects.id = $1 AND projects.deleted_at IS NULL
            FOR UPDATE OF projects
            "#,
        )
        .bind(update.project_id)
        .bind(update.actor_id)
        .fetch_optional(&mut *transaction)
        .await
        .map_err(ProjectsRepositoryError::unavailable)?
        .ok_or(ProjectsRepositoryError::NotFound)?;
        let access = ProjectAccess::try_from(row)?;
        if !access.role.can(PermissionAction::ManageProject) {
            return Err(ProjectsRepositoryError::Forbidden);
        }
        let mut project = access.project;
        let mut changed_fields = Vec::new();
        if let Some(name) = update.name
            && project.name != name.as_str()
        {
            project.name = name.as_str().to_owned();
            changed_fields.push("name");
        }
        if let Some(slug) = update.slug
            && project.slug != slug.as_str()
        {
            project.slug = slug.as_str().to_owned();
            changed_fields.push("slug");
        }
        if let Some(description) = update.description {
            let description = description.into_inner();
            if project.description != description {
                project.description = description;
                changed_fields.push("description");
            }
        }
        if let Some(spa_fallback) = update.spa_fallback
            && project.spa_fallback != spa_fallback
        {
            project.spa_fallback = spa_fallback;
            changed_fields.push("spaFallback");
        }
        if let Some(cache_policy) = update.cache_policy
            && project.cache_policy != cache_policy
        {
            project.cache_policy = cache_policy;
            changed_fields.push("cachePolicy");
        }
        if changed_fields.is_empty() {
            transaction
                .commit()
                .await
                .map_err(ProjectsRepositoryError::unavailable)?;
            return Ok(project);
        }

        let row = sqlx::query_as::<_, ProjectRow>(
            r#"
            UPDATE projects
            SET name = $2,
                slug = $3,
                description = $4,
                spa_fallback = $5,
                cache_policy = $6,
                updated_at = $7
            WHERE id = $1 AND deleted_at IS NULL
            RETURNING
                id,
                organization_id,
                name,
                slug,
                description,
                spa_fallback,
                cache_policy,
                (SELECT release_id FROM project_active_releases WHERE project_id = $1)
                    AS active_release_id,
                created_by,
                created_at,
                updated_at
            "#,
        )
        .bind(update.project_id)
        .bind(&project.name)
        .bind(&project.slug)
        .bind(&project.description)
        .bind(project.spa_fallback)
        .bind(project.cache_policy.as_str())
        .bind(update.updated_at)
        .fetch_one(&mut *transaction)
        .await
        .map_err(map_project_write_error)?;
        sqlx::query(
            r#"
            INSERT INTO audit_logs (
                organization_id, project_id, actor_id, action,
                target_type, target_id, metadata, created_at
            )
            VALUES ($1, $2, $3, 'project.updated', 'project', $2, $4, $5)
            "#,
        )
        .bind(project.organization_id)
        .bind(update.project_id)
        .bind(update.actor_id)
        .bind(json!({ "changedFields": changed_fields }))
        .bind(update.updated_at)
        .execute(&mut *transaction)
        .await
        .map_err(ProjectsRepositoryError::unavailable)?;
        transaction
            .commit()
            .await
            .map_err(ProjectsRepositoryError::unavailable)?;
        row.try_into()
    }

    async fn list_projects(
        &self,
        organization_id: Uuid,
        actor_id: Uuid,
    ) -> Result<Vec<Project>, ProjectsRepositoryError> {
        let rows = sqlx::query_as::<_, ProjectRow>(
            r#"
            SELECT
                projects.id,
                projects.organization_id,
                projects.name,
                projects.slug,
                projects.description,
                projects.spa_fallback,
                projects.cache_policy,
                project_active_releases.release_id AS active_release_id,
                projects.created_by,
                projects.created_at,
                projects.updated_at
            FROM projects
            LEFT JOIN project_active_releases
                ON project_active_releases.project_id = projects.id
            WHERE projects.organization_id = $1
              AND projects.deleted_at IS NULL
              AND EXISTS (
                  SELECT 1
                  FROM memberships
                  WHERE memberships.organization_id = projects.organization_id
                    AND memberships.user_id = $2
              )
            ORDER BY projects.created_at DESC, projects.id DESC
            "#,
        )
        .bind(organization_id)
        .bind(actor_id)
        .fetch_all(&self.pool)
        .await
        .map_err(ProjectsRepositoryError::unavailable)?;
        if rows.is_empty()
            && self
                .membership_role(organization_id, actor_id)
                .await?
                .is_none()
        {
            return Err(ProjectsRepositoryError::Forbidden);
        }
        rows.into_iter().map(TryInto::try_into).collect()
    }

    async fn find_project_for_member(
        &self,
        project_id: Uuid,
        actor_id: Uuid,
    ) -> Result<Option<ProjectAccess>, ProjectsRepositoryError> {
        let row = sqlx::query_as::<_, ProjectAccessRow>(
            r#"
            SELECT
                projects.id,
                projects.organization_id,
                projects.name,
                projects.slug,
                projects.description,
                projects.spa_fallback,
                projects.cache_policy,
                project_active_releases.release_id AS active_release_id,
                projects.created_by,
                projects.created_at,
                projects.updated_at,
                memberships.role
            FROM projects
            INNER JOIN memberships
                ON memberships.organization_id = projects.organization_id
               AND memberships.user_id = $2
            LEFT JOIN project_active_releases
                ON project_active_releases.project_id = projects.id
            WHERE projects.id = $1
              AND projects.deleted_at IS NULL
            "#,
        )
        .bind(project_id)
        .bind(actor_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(ProjectsRepositoryError::unavailable)?;
        row.map(TryInto::try_into).transpose()
    }
}

fn map_project_write_error(error: sqlx::Error) -> ProjectsRepositoryError {
    if let sqlx::Error::Database(database_error) = &error
        && database_error.constraint() == Some("projects_slug_unique")
    {
        return ProjectsRepositoryError::DuplicateSlug;
    }
    ProjectsRepositoryError::unavailable(error)
}

fn parse_role(value: &str) -> Result<MemberRole, ProjectsRepositoryError> {
    MemberRole::from_str(value).map_err(|_| corrupt_record("memberships.role"))
}

fn parse_cache_policy(value: &str) -> Result<CachePolicy, ProjectsRepositoryError> {
    CachePolicy::from_str(value).map_err(|_| corrupt_record("projects.cache_policy"))
}

#[derive(Debug, FromRow)]
struct OrganizationRow {
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
struct MemberRow {
    user_id: Uuid,
    email: String,
    display_name: String,
    role: String,
    joined_at: OffsetDateTime,
}

impl TryFrom<MemberRow> for MemberSummary {
    type Error = ProjectsRepositoryError;

    fn try_from(row: MemberRow) -> Result<Self, Self::Error> {
        Ok(Self {
            user_id: row.user_id,
            email: row.email,
            display_name: row.display_name,
            role: parse_role(&row.role)?,
            joined_at: row.joined_at,
        })
    }
}

#[derive(Debug, FromRow)]
struct ProjectRow {
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
struct ProjectAccessRow {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_unknown_roles_and_cache_policies() {
        assert!(parse_role("superuser").is_err());
        assert!(parse_cache_policy("forever").is_err());
    }
}
