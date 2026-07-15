use super::*;

#[derive(Default)]
pub(super) struct TestDeploymentsRepository {
    deployments: Mutex<Vec<Deployment>>,
}

#[async_trait]
impl DeploymentsRepository for TestDeploymentsRepository {
    async fn execute(
        &self,
        command: NewDeployment,
    ) -> Result<DeploymentResult, DeploymentsRepositoryError> {
        let deployment = Deployment {
            id: command.id,
            project_id: command.project_id,
            release_id: command.release_id,
            previous_release_id: None,
            action: command.action,
            status: DeploymentStatus::Succeeded,
            actor_id: command.actor_id,
            message: command.message,
            created_at: command.now,
            finished_at: command.now,
        };
        self.deployments.lock().unwrap().push(deployment.clone());
        Ok(DeploymentResult {
            deployment,
            active_release_id: command.release_id,
            replayed: false,
        })
    }

    async fn list_for_project(
        &self,
        project_id: Uuid,
        _actor_id: Uuid,
    ) -> Result<Vec<Deployment>, DeploymentsRepositoryError> {
        Ok(self
            .deployments
            .lock()
            .unwrap()
            .iter()
            .rev()
            .filter(|deployment| deployment.project_id == project_id)
            .cloned()
            .collect())
    }
}

pub(super) struct TestReleasesRepository;

pub(super) struct TestAuditRepository;

#[async_trait]
impl AuditRepository for TestAuditRepository {
    async fn list(&self, request: AuditPageRequest) -> Result<AuditPage, AuditRepositoryError> {
        Ok(AuditPage {
            entries: vec![AuditEntry {
                id: Uuid::from_u128(71),
                organization_id: request.organization_id,
                project_id: request.project_id,
                actor: Some(AuditActor {
                    id: request.actor_id,
                    email: "owner@example.com".to_owned(),
                    display_name: "Owner".to_owned(),
                }),
                action: "release.published".to_owned(),
                target_type: "release".to_owned(),
                target_id: Some(Uuid::from_u128(72)),
                request_id: Some(Uuid::from_u128(73)),
                metadata: json!({ "versionNumber": 2 }),
                created_at: OffsetDateTime::UNIX_EPOCH,
            }],
            next_cursor: None,
        })
    }
}

#[async_trait]
impl ReleasesRepository for TestReleasesRepository {
    async fn list_for_project(
        &self,
        project_id: Uuid,
        actor_id: Uuid,
    ) -> Result<ProjectReleases, ReleasesRepositoryError> {
        Ok(ProjectReleases {
            project_slug: zipship_domain::ProjectSlug::parse("marketing").unwrap(),
            releases: vec![Release {
                id: Uuid::from_u128(91),
                project_id,
                version_number: 1,
                state: ReleaseStatus::Ready,
                failure_code: None,
                artifact: Some(ReleaseArtifact {
                    digest: ArtifactDigest::parse("ab".repeat(32)).unwrap(),
                    file_count: 1,
                    total_size: 4,
                    manifest: ArtifactManifest {
                        version: 1,
                        files: vec![ManifestEntry {
                            path: "index.html".to_owned(),
                            size: 4,
                            sha256: "cd".repeat(32),
                        }],
                    },
                    detect_report: json!({ "entryDirectory": "dist" }),
                }),
                is_active: true,
                created_by: actor_id,
                created_at: OffsetDateTime::UNIX_EPOCH,
                ready_at: Some(OffsetDateTime::UNIX_EPOCH),
                archived_at: None,
            }],
        })
    }
}
