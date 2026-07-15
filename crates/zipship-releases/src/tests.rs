use super::*;

struct MissingRepository;

#[async_trait]
impl ReleasesRepository for MissingRepository {
    async fn list_for_project(
        &self,
        _project_id: Uuid,
        _actor_id: Uuid,
    ) -> Result<ProjectReleases, ReleasesRepositoryError> {
        Err(ReleasesRepositoryError::ProjectNotFound)
    }
}

#[tokio::test]
async fn preserves_the_stable_not_found_boundary() {
    let service = ReleasesService::new(Arc::new(MissingRepository));
    assert_eq!(
        service.list(Uuid::nil(), Uuid::nil()).await.unwrap_err(),
        ReleasesError::ProjectNotFound
    );
    assert_eq!(ReleasesError::ProjectNotFound.code(), "PROJECT_NOT_FOUND");
}
