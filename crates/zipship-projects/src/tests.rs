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

#[tokio::test]
async fn lists_only_the_current_users_organizations() {
    let (_, service, user_id, _) = fixture(MemberRole::Viewer);
    let organizations = service.list_organizations(user_id).await.unwrap();
    assert_eq!(organizations.len(), 1);
    assert_eq!(organizations[0].role, MemberRole::Viewer);
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

#[tokio::test]
async fn only_managers_update_normalized_project_settings() {
    let (repository, service, user_id, organization_id) = fixture(MemberRole::Owner);
    let project = service
        .create_project(create_command(user_id, organization_id))
        .await
        .unwrap();
    let updated = service
        .update_project(UpdateProjectCommand {
            actor_id: user_id,
            project_id: project.id,
            name: Some(" Product Site ".to_owned()),
            slug: Some(" Product-Site ".to_owned()),
            description: Some(None),
            spa_fallback: Some(false),
            cache_policy: Some("aggressive".to_owned()),
        })
        .await
        .unwrap();
    assert_eq!(updated.name, "Product Site");
    assert_eq!(updated.slug, "product-site");
    assert_eq!(updated.description, None);
    assert!(!updated.spa_fallback);
    assert_eq!(updated.cache_policy, CachePolicy::Aggressive);

    let viewer_id = Uuid::new_v4();
    repository
        .state
        .lock()
        .unwrap()
        .memberships
        .push(Membership {
            organization_id,
            user_id: viewer_id,
            role: MemberRole::Viewer,
        });
    assert_eq!(
        service
            .update_project(UpdateProjectCommand {
                actor_id: viewer_id,
                project_id: project.id,
                name: Some("Forbidden".to_owned()),
                slug: None,
                description: None,
                spa_fallback: None,
                cache_policy: None,
            })
            .await,
        Err(ProjectsError::Forbidden)
    );
}

#[tokio::test]
async fn rejects_empty_or_invalid_project_updates_before_persistence() {
    let (_, service, user_id, _) = fixture(MemberRole::Owner);
    let empty = UpdateProjectCommand {
        actor_id: user_id,
        project_id: Uuid::new_v4(),
        name: None,
        slug: None,
        description: None,
        spa_fallback: None,
        cache_policy: None,
    };
    assert_eq!(
        service.update_project(empty).await,
        Err(ProjectsError::InvalidInput)
    );
    assert_eq!(
        service
            .update_project(UpdateProjectCommand {
                actor_id: user_id,
                project_id: Uuid::new_v4(),
                name: None,
                slug: None,
                description: None,
                spa_fallback: None,
                cache_policy: Some("forever".to_owned()),
            })
            .await,
        Err(ProjectsError::InvalidInput)
    );
}
