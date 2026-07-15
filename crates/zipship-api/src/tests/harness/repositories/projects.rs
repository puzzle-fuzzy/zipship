use super::*;

#[derive(Default)]
pub(super) struct TestProjectsRepository {
    projects: Mutex<Vec<Project>>,
}
#[async_trait]
impl ProjectsRepository for TestProjectsRepository {
    async fn list_organizations(
        &self,
        _actor_id: Uuid,
    ) -> Result<Vec<OrganizationSummary>, ProjectsRepositoryError> {
        Ok(vec![OrganizationSummary {
            id: TEST_ORGANIZATION_ID,
            name: "Test Organization".to_owned(),
            slug: "test-organization".to_owned(),
            role: MemberRole::Owner,
            created_at: OffsetDateTime::UNIX_EPOCH,
        }])
    }

    async fn membership_role(
        &self,
        organization_id: Uuid,
        _actor_id: Uuid,
    ) -> Result<Option<MemberRole>, ProjectsRepositoryError> {
        Ok((organization_id == TEST_ORGANIZATION_ID).then_some(MemberRole::Owner))
    }

    async fn create_project(
        &self,
        project: NewProject,
    ) -> Result<Project, ProjectsRepositoryError> {
        if project.organization_id != TEST_ORGANIZATION_ID {
            return Err(ProjectsRepositoryError::Forbidden);
        }
        let mut projects = self.projects.lock().unwrap();
        if projects
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
        projects.push(project.clone());
        Ok(project)
    }

    async fn update_project(
        &self,
        update: UpdateProject,
    ) -> Result<Project, ProjectsRepositoryError> {
        let mut projects = self.projects.lock().unwrap();
        if let Some(slug) = update.slug.as_ref()
            && projects
                .iter()
                .any(|project| project.id != update.project_id && project.slug == slug.as_str())
        {
            return Err(ProjectsRepositoryError::DuplicateSlug);
        }
        let project = projects
            .iter_mut()
            .find(|project| project.id == update.project_id)
            .ok_or(ProjectsRepositoryError::NotFound)?;
        if let Some(name) = update.name {
            project.name = name.as_str().to_owned();
        }
        if let Some(slug) = update.slug {
            project.slug = slug.as_str().to_owned();
        }
        if let Some(description) = update.description {
            project.description = description.into_inner();
        }
        if let Some(spa_fallback) = update.spa_fallback {
            project.spa_fallback = spa_fallback;
        }
        if let Some(cache_policy) = update.cache_policy {
            project.cache_policy = cache_policy;
        }
        project.updated_at = update.updated_at;
        Ok(project.clone())
    }

    async fn list_projects(
        &self,
        organization_id: Uuid,
        _actor_id: Uuid,
    ) -> Result<Vec<Project>, ProjectsRepositoryError> {
        if organization_id != TEST_ORGANIZATION_ID {
            return Err(ProjectsRepositoryError::Forbidden);
        }
        Ok(self.projects.lock().unwrap().clone())
    }

    async fn find_project_for_member(
        &self,
        project_id: Uuid,
        actor_id: Uuid,
    ) -> Result<Option<ProjectAccess>, ProjectsRepositoryError> {
        Ok(self
            .projects
            .lock()
            .unwrap()
            .iter()
            .find(|project| project.id == project_id && project.created_by == actor_id)
            .cloned()
            .map(|project| ProjectAccess {
                project,
                role: MemberRole::Owner,
            }))
    }
}
