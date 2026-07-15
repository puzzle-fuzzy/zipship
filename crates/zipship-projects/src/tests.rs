use super::*;
use async_trait::async_trait;
use std::sync::{Arc, Mutex};
use time::OffsetDateTime;
use uuid::Uuid;
use zipship_domain::{CachePolicy, MemberRole, PermissionAction};

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
                    membership.organization_id == organization.id && membership.user_id == actor_id
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

    async fn update_project(
        &self,
        update: UpdateProject,
    ) -> Result<Project, ProjectsRepositoryError> {
        let mut state = self.state.lock().unwrap();
        let Some(index) = state
            .projects
            .iter()
            .position(|project| project.id == update.project_id)
        else {
            return Err(ProjectsRepositoryError::NotFound);
        };
        let organization_id = state.projects[index].organization_id;
        let role = state
            .memberships
            .iter()
            .find(|membership| {
                membership.organization_id == organization_id
                    && membership.user_id == update.actor_id
            })
            .map(|membership| membership.role)
            .ok_or(ProjectsRepositoryError::NotFound)?;
        if !role.can(PermissionAction::ManageProject) {
            return Err(ProjectsRepositoryError::Forbidden);
        }
        if let Some(slug) = update.slug.as_ref()
            && state
                .projects
                .iter()
                .any(|project| project.id != update.project_id && project.slug == slug.as_str())
        {
            return Err(ProjectsRepositoryError::DuplicateSlug);
        }
        let project = &mut state.projects[index];
        let mut changed = false;
        if let Some(name) = update.name
            && project.name != name.as_str()
        {
            project.name = name.as_str().to_owned();
            changed = true;
        }
        if let Some(slug) = update.slug
            && project.slug != slug.as_str()
        {
            project.slug = slug.as_str().to_owned();
            changed = true;
        }
        if let Some(description) = update.description {
            let description = description.into_inner();
            if project.description != description {
                project.description = description;
                changed = true;
            }
        }
        if let Some(spa_fallback) = update.spa_fallback
            && project.spa_fallback != spa_fallback
        {
            project.spa_fallback = spa_fallback;
            changed = true;
        }
        if let Some(cache_policy) = update.cache_policy
            && project.cache_policy != cache_policy
        {
            project.cache_policy = cache_policy;
            changed = true;
        }
        if changed {
            project.updated_at = update.updated_at;
        }
        Ok(project.clone())
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

mod cases;
