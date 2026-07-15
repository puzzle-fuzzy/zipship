use super::*;

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
