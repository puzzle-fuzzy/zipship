use super::*;
use axum::{
    body::{Body, to_bytes},
    extract::ConnectInfo,
    http::{Request, header},
};
use secrecy::{ExposeSecret, SecretBox};
use serde_json::{Value, json};
use std::{net::SocketAddr, sync::Mutex};
use time::OffsetDateTime;
use tower::ServiceExt;
use uuid::Uuid;
use zipship_artifact::{ArtifactManifest, ManifestEntry};
use zipship_audit::{
    AuditActor, AuditEntry, AuditPage, AuditPageRequest, AuditRepository, AuditRepositoryError,
    AuditService,
};
use zipship_auth::{
    AuthRepository, AuthRepositoryError, NewPersonalOrganization, NewSession, NewUser,
    NormalizedEmail, ResolvedSession, StoredUser, TokenDigest,
};
use zipship_deployments::{
    Deployment, DeploymentResult, DeploymentStatus, DeploymentsRepository,
    DeploymentsRepositoryError, DeploymentsService, NewDeployment,
};
use zipship_domain::{ArtifactDigest, CachePolicy, MemberRole, ReleaseStatus, UploadStatus};
use zipship_invitations::{
    AcceptInvitation, AcceptedInvitation, Invitation, InvitationState, InvitationsRepository,
    InvitationsRepositoryError, InvitationsService, ListInvitations, NewInvitation,
    RevokeInvitation,
};
use zipship_members::{
    Member, MembersRepository, MembersRepositoryError, RemoveMember, UpdateMemberRole,
};
use zipship_projects::{
    NewProject, OrganizationSummary, Project, ProjectAccess, ProjectsRepository,
    ProjectsRepositoryError, UpdateProject,
};
use zipship_recovery::{
    ConsumePasswordReset, EnvelopeKeyRing, NewPasswordReset, PasswordRecoveryRepository,
    PasswordRecoveryRepositoryError, PasswordResetRequestDisposition,
};
use zipship_releases::{
    ProjectReleases, Release, ReleaseArtifact, ReleasesRepository, ReleasesRepositoryError,
    ReleasesService,
};
use zipship_tokens::{
    ApiToken, ApiTokenState, ApiTokensRepository, ApiTokensRepositoryError, ListApiTokens,
    NewApiToken, ResolveApiToken, ResolvedApiToken, RevokeApiToken,
};
use zipship_uploads::{
    BeginReceiveResult, FinalizeResult, FinalizedUpload, NewUpload, ReceiveLease, UploadLimits,
    UploadRecord, UploadsRepository, UploadsRepositoryError,
};

const TEST_ORGANIZATION_ID: Uuid = Uuid::from_u128(1);

struct Probe {
    status: CheckStatus,
    _storage_root: tempfile::TempDir,
}

#[async_trait]
impl ReadinessProbe for Probe {
    async fn check(&self) -> BTreeMap<String, CheckStatus> {
        BTreeMap::from([("database".to_owned(), self.status.clone())])
    }
}

#[derive(Default)]
struct AuthState {
    users: Vec<StoredUser>,
    sessions: Vec<NewSession>,
}

#[derive(Default)]
struct TestAuthRepository {
    state: Mutex<AuthState>,
}

#[derive(Default)]
struct TestProjectsRepository {
    projects: Mutex<Vec<Project>>,
}

struct TestMembersRepository;

#[derive(Default)]
struct TestInvitationsRepository {
    invitations: Mutex<Vec<(Invitation, TokenDigest)>>,
}

#[derive(Default)]
struct RecoveryState {
    created: Vec<NewPasswordReset>,
    consumed: Vec<ConsumePasswordReset>,
}

#[derive(Default)]
struct TestRecoveryRepository {
    state: Mutex<RecoveryState>,
}

#[derive(Default)]
struct TestApiTokensRepository {
    tokens: Mutex<Vec<(ApiToken, TokenDigest)>>,
}

#[async_trait]
impl ApiTokensRepository for TestApiTokensRepository {
    async fn create_token(
        &self,
        token: NewApiToken,
        active_token_limit: u16,
    ) -> Result<ApiToken, ApiTokensRepositoryError> {
        let mut tokens = self.tokens.lock().unwrap();
        let active_count = tokens
            .iter()
            .filter(|(stored, _)| {
                stored.user_id == token.user_id
                    && stored.state_at(token.created_at) == ApiTokenState::Active
            })
            .count();
        if active_count >= usize::from(active_token_limit) {
            return Err(ApiTokensRepositoryError::LimitReached);
        }
        let stored = ApiToken {
            id: token.id,
            user_id: token.user_id,
            name: token.name.as_str().to_owned(),
            display_prefix: token.display_prefix,
            scopes: token.scopes.as_slice().to_vec(),
            expires_at: token.expires_at,
            last_used_at: None,
            revoked_at: None,
            created_at: token.created_at,
        };
        tokens.push((stored.clone(), token.token_digest));
        Ok(stored)
    }

    async fn list_tokens(
        &self,
        request: ListApiTokens,
    ) -> Result<Vec<ApiToken>, ApiTokensRepositoryError> {
        let mut tokens = self
            .tokens
            .lock()
            .unwrap()
            .iter()
            .filter(|(token, _)| token.user_id == request.user_id)
            .map(|(token, _)| token.clone())
            .collect::<Vec<_>>();
        tokens.sort_by_key(|token| {
            (
                token.state_at(request.now) != ApiTokenState::Active,
                std::cmp::Reverse(token.created_at),
            )
        });
        Ok(tokens)
    }

    async fn revoke_token(
        &self,
        request: RevokeApiToken,
    ) -> Result<ApiToken, ApiTokensRepositoryError> {
        let mut tokens = self.tokens.lock().unwrap();
        let token = tokens
            .iter_mut()
            .find(|(token, _)| token.id == request.token_id && token.user_id == request.user_id)
            .map(|(token, _)| token)
            .ok_or(ApiTokensRepositoryError::NotFound)?;
        token.revoked_at.get_or_insert(request.revoked_at);
        Ok(token.clone())
    }

    async fn resolve_token(
        &self,
        request: ResolveApiToken,
    ) -> Result<Option<ResolvedApiToken>, ApiTokensRepositoryError> {
        let mut tokens = self.tokens.lock().unwrap();
        let Some(token) = tokens
            .iter_mut()
            .find(|(token, digest)| {
                *digest == request.token_digest
                    && token.state_at(request.used_at) == ApiTokenState::Active
            })
            .map(|(token, _)| token)
        else {
            return Ok(None);
        };
        token.last_used_at = Some(request.used_at);
        Ok(Some(ResolvedApiToken {
            token: token.clone(),
            user_disabled_at: None,
        }))
    }
}

#[async_trait]
impl PasswordRecoveryRepository for TestRecoveryRepository {
    async fn create_password_reset(
        &self,
        reset: NewPasswordReset,
    ) -> Result<PasswordResetRequestDisposition, PasswordRecoveryRepositoryError> {
        self.state.lock().unwrap().created.push(reset);
        Ok(PasswordResetRequestDisposition::Created)
    }

    async fn consume_password_reset(
        &self,
        reset: ConsumePasswordReset,
    ) -> Result<(), PasswordRecoveryRepositoryError> {
        self.state.lock().unwrap().consumed.push(reset);
        Ok(())
    }
}

#[derive(Default)]
struct UploadState {
    upload: Option<UploadRecord>,
    transfer_id: Option<Uuid>,
    finalized: Option<FinalizedUpload>,
}

#[derive(Default)]
struct TestUploadsRepository {
    state: Mutex<UploadState>,
}

#[derive(Default)]
struct TestDeploymentsRepository {
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

struct TestReleasesRepository;

struct TestAuditRepository;

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

#[async_trait]
impl UploadsRepository for TestUploadsRepository {
    async fn project_role(
        &self,
        _project_id: Uuid,
        _actor_id: Uuid,
    ) -> Result<Option<MemberRole>, UploadsRepositoryError> {
        Ok(Some(MemberRole::Owner))
    }

    async fn create_upload(
        &self,
        upload: NewUpload,
    ) -> Result<UploadRecord, UploadsRepositoryError> {
        let record = UploadRecord {
            id: upload.id,
            project_id: upload.project_id,
            release_id: None,
            original_filename: upload.original_filename.as_str().to_owned(),
            status: UploadStatus::Pending,
            expected_size: upload.expected_size.bytes(),
            received_size: 0,
            staging_key: upload.staging_key,
            created_by: upload.created_by,
            created_at: upload.created_at,
            uploaded_at: None,
            completed_at: None,
            expires_at: upload.expires_at,
            error_code: None,
        };
        self.state.lock().unwrap().upload = Some(record.clone());
        Ok(record)
    }

    async fn begin_receive(
        &self,
        upload_id: Uuid,
        _actor_id: Uuid,
        transfer_id: Uuid,
        now: OffsetDateTime,
        _lease_expires_at: OffsetDateTime,
    ) -> Result<BeginReceiveResult, UploadsRepositoryError> {
        let mut state = self.state.lock().unwrap();
        let upload = state
            .upload
            .as_mut()
            .filter(|upload| upload.id == upload_id)
            .ok_or(UploadsRepositoryError::NotFound)?;
        if upload.expires_at <= now {
            return Err(UploadsRepositoryError::Expired);
        }
        if matches!(
            upload.status,
            UploadStatus::Uploaded | UploadStatus::Processing | UploadStatus::Completed
        ) {
            return Ok(BeginReceiveResult::AlreadyUploaded(upload.clone()));
        }
        if upload.status != UploadStatus::Pending {
            return Err(UploadsRepositoryError::StateConflict);
        }
        upload.status = UploadStatus::Receiving;
        upload.received_size = 0;
        upload.error_code = None;
        let upload = upload.clone();
        state.transfer_id = Some(transfer_id);
        Ok(BeginReceiveResult::Started(ReceiveLease {
            upload,
            transfer_id,
        }))
    }

    async fn mark_uploaded(
        &self,
        upload_id: Uuid,
        _actor_id: Uuid,
        transfer_id: Uuid,
        received_size: u64,
        now: OffsetDateTime,
    ) -> Result<UploadRecord, UploadsRepositoryError> {
        let mut state = self.state.lock().unwrap();
        if state.transfer_id != Some(transfer_id) {
            return Err(UploadsRepositoryError::StateConflict);
        }
        let upload = state
            .upload
            .as_mut()
            .filter(|upload| upload.id == upload_id)
            .ok_or(UploadsRepositoryError::NotFound)?;
        if received_size != upload.expected_size {
            return Err(UploadsRepositoryError::SizeMismatch);
        }
        upload.status = UploadStatus::Uploaded;
        upload.received_size = received_size;
        upload.uploaded_at = Some(now);
        upload.error_code = None;
        Ok(upload.clone())
    }

    async fn requeue_receive(
        &self,
        upload_id: Uuid,
        _actor_id: Uuid,
        transfer_id: Uuid,
        error_code: &'static str,
        _now: OffsetDateTime,
    ) -> Result<(), UploadsRepositoryError> {
        let mut state = self.state.lock().unwrap();
        if state.transfer_id != Some(transfer_id) {
            return Err(UploadsRepositoryError::StateConflict);
        }
        let upload = state
            .upload
            .as_mut()
            .filter(|upload| upload.id == upload_id)
            .ok_or(UploadsRepositoryError::NotFound)?;
        upload.status = UploadStatus::Pending;
        upload.received_size = 0;
        upload.error_code = Some(error_code.to_owned());
        state.transfer_id = None;
        Ok(())
    }

    async fn finalize_upload(
        &self,
        upload_id: Uuid,
        _actor_id: Uuid,
        _now: OffsetDateTime,
    ) -> Result<FinalizeResult, UploadsRepositoryError> {
        let mut state = self.state.lock().unwrap();
        if let Some(finalized) = state.finalized.clone() {
            return Ok(FinalizeResult::Existing(finalized));
        }
        let upload = state
            .upload
            .as_mut()
            .filter(|upload| upload.id == upload_id)
            .ok_or(UploadsRepositoryError::NotFound)?;
        if upload.status != UploadStatus::Uploaded {
            return Err(UploadsRepositoryError::StateConflict);
        }
        let release_id = Uuid::new_v4();
        let job_id = Uuid::new_v4();
        upload.status = UploadStatus::Processing;
        upload.release_id = Some(release_id);
        let finalized = FinalizedUpload {
            upload: upload.clone(),
            release_id,
            job_id,
        };
        state.finalized = Some(finalized.clone());
        Ok(FinalizeResult::Created(finalized))
    }

    async fn find_upload_for_member(
        &self,
        upload_id: Uuid,
        _actor_id: Uuid,
    ) -> Result<Option<UploadRecord>, UploadsRepositoryError> {
        Ok(self
            .state
            .lock()
            .unwrap()
            .upload
            .clone()
            .filter(|upload| upload.id == upload_id))
    }
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

#[async_trait]
impl MembersRepository for TestMembersRepository {
    async fn list_members(
        &self,
        organization_id: Uuid,
        actor_id: Uuid,
    ) -> Result<Vec<Member>, MembersRepositoryError> {
        if organization_id != TEST_ORGANIZATION_ID {
            return Err(MembersRepositoryError::Forbidden);
        }
        Ok(vec![Member {
            user_id: actor_id,
            email: "owner@example.com".to_owned(),
            display_name: "Owner".to_owned(),
            role: MemberRole::Owner,
            joined_at: OffsetDateTime::UNIX_EPOCH,
        }])
    }

    async fn update_role(
        &self,
        update: UpdateMemberRole,
    ) -> Result<Member, MembersRepositoryError> {
        if update.organization_id != TEST_ORGANIZATION_ID {
            return Err(MembersRepositoryError::Forbidden);
        }
        if update.target_user_id == update.actor_id && update.role != MemberRole::Owner {
            return Err(MembersRepositoryError::LastOwner);
        }
        Ok(Member {
            user_id: update.target_user_id,
            email: "member@example.com".to_owned(),
            display_name: "Member".to_owned(),
            role: update.role,
            joined_at: OffsetDateTime::UNIX_EPOCH,
        })
    }

    async fn remove_member(&self, removal: RemoveMember) -> Result<(), MembersRepositoryError> {
        if removal.organization_id != TEST_ORGANIZATION_ID {
            return Err(MembersRepositoryError::Forbidden);
        }
        if removal.target_user_id == removal.actor_id {
            return Err(MembersRepositoryError::LastOwner);
        }
        Ok(())
    }
}

#[async_trait]
impl InvitationsRepository for TestInvitationsRepository {
    async fn create_invitation(
        &self,
        invitation: NewInvitation,
    ) -> Result<Invitation, InvitationsRepositoryError> {
        let stored = Invitation {
            id: invitation.id,
            organization_id: invitation.organization_id,
            email: invitation.email.as_str().to_owned(),
            role: invitation.role,
            state: InvitationState::Pending,
            invited_by: Some(invitation.invited_by),
            accepted_by: None,
            created_at: invitation.created_at,
            expires_at: invitation.expires_at,
            resolved_at: None,
        };
        self.invitations
            .lock()
            .unwrap()
            .push((stored.clone(), invitation.token_digest));
        Ok(stored)
    }

    async fn list_invitations(
        &self,
        request: ListInvitations,
    ) -> Result<Vec<Invitation>, InvitationsRepositoryError> {
        if request.organization_id != TEST_ORGANIZATION_ID {
            return Err(InvitationsRepositoryError::Forbidden);
        }
        Ok(self
            .invitations
            .lock()
            .unwrap()
            .iter()
            .map(|(invitation, _)| invitation)
            .filter(|invitation| {
                invitation.state == InvitationState::Pending && invitation.expires_at > request.now
            })
            .cloned()
            .collect())
    }

    async fn revoke_invitation(
        &self,
        request: RevokeInvitation,
    ) -> Result<(), InvitationsRepositoryError> {
        let mut invitations = self.invitations.lock().unwrap();
        let invitation = invitations
            .iter_mut()
            .map(|(invitation, _)| invitation)
            .find(|invitation| {
                invitation.organization_id == request.organization_id
                    && invitation.id == request.invitation_id
                    && invitation.state == InvitationState::Pending
            })
            .ok_or(InvitationsRepositoryError::NotFound)?;
        invitation.state = InvitationState::Revoked;
        invitation.resolved_at = Some(request.revoked_at);
        Ok(())
    }

    async fn accept_invitation(
        &self,
        request: AcceptInvitation,
    ) -> Result<AcceptedInvitation, InvitationsRepositoryError> {
        let mut invitations = self.invitations.lock().unwrap();
        let invitation = invitations
            .iter_mut()
            .find(|(_, digest)| *digest == request.token_digest)
            .map(|(invitation, _)| invitation)
            .ok_or(InvitationsRepositoryError::NotFound)?;
        if invitation.state == InvitationState::Accepted
            && invitation.accepted_by == Some(request.actor_id)
        {
            return Ok(AcceptedInvitation {
                invitation_id: invitation.id,
                organization_id: invitation.organization_id,
                user_id: request.actor_id,
                role: invitation.role,
                replayed: true,
            });
        }
        if invitation.state != InvitationState::Pending {
            return Err(InvitationsRepositoryError::NotFound);
        }
        if invitation.email != request.actor_email.as_str() {
            return Err(InvitationsRepositoryError::WrongRecipient);
        }
        invitation.state = InvitationState::Accepted;
        invitation.accepted_by = Some(request.actor_id);
        invitation.resolved_at = Some(request.accepted_at);
        Ok(AcceptedInvitation {
            invitation_id: invitation.id,
            organization_id: invitation.organization_id,
            user_id: request.actor_id,
            role: invitation.role,
            replayed: false,
        })
    }
}

#[async_trait]
impl AuthRepository for TestAuthRepository {
    async fn create_user_with_session(
        &self,
        user: NewUser,
        _organization: NewPersonalOrganization,
        session: NewSession,
    ) -> Result<(), AuthRepositoryError> {
        let mut state = self.state.lock().unwrap();
        if state.users.iter().any(|stored| stored.email == user.email) {
            return Err(AuthRepositoryError::DuplicateEmail);
        }
        state.users.push(stored_user(user));
        state.sessions.push(session);
        Ok(())
    }

    async fn find_user_by_email(
        &self,
        email: &NormalizedEmail,
    ) -> Result<Option<StoredUser>, AuthRepositoryError> {
        Ok(self
            .state
            .lock()
            .unwrap()
            .users
            .iter()
            .find(|user| &user.email == email)
            .cloned())
    }

    async fn create_session(&self, session: NewSession) -> Result<(), AuthRepositoryError> {
        self.state.lock().unwrap().sessions.push(session);
        Ok(())
    }

    async fn update_display_name(
        &self,
        user_id: Uuid,
        display_name: zipship_auth::DisplayName,
        _updated_at: OffsetDateTime,
    ) -> Result<StoredUser, AuthRepositoryError> {
        let mut state = self.state.lock().unwrap();
        let user = state
            .users
            .iter_mut()
            .find(|user| user.id == user_id)
            .ok_or(AuthRepositoryError::UserNotFound)?;
        user.display_name = display_name;
        Ok(user.clone())
    }

    async fn resolve_session(
        &self,
        token_digest: TokenDigest,
        now: OffsetDateTime,
    ) -> Result<Option<ResolvedSession>, AuthRepositoryError> {
        let state = self.state.lock().unwrap();
        let Some(session) = state
            .sessions
            .iter()
            .find(|session| session.token_digest == token_digest && session.expires_at > now)
        else {
            return Ok(None);
        };
        Ok(state
            .users
            .iter()
            .find(|user| user.id == session.user_id)
            .cloned()
            .map(|user| ResolvedSession {
                session_id: session.id,
                user,
                csrf_digest: session.csrf_digest,
            }))
    }

    async fn revoke_session(
        &self,
        token_digest: TokenDigest,
        _revoked_at: OffsetDateTime,
    ) -> Result<(), AuthRepositoryError> {
        self.state
            .lock()
            .unwrap()
            .sessions
            .retain(|session| session.token_digest != token_digest);
        Ok(())
    }
}

fn stored_user(user: NewUser) -> StoredUser {
    StoredUser {
        id: user.id,
        email: user.email,
        display_name: user.display_name,
        password_hash: user.password_hash,
        disabled_at: None,
    }
}

async fn test_app(status: CheckStatus, secure_cookies: bool) -> Router {
    test_app_with_storage(status, secure_cookies).await.0
}

async fn test_app_with_storage(
    status: CheckStatus,
    secure_cookies: bool,
) -> (Router, LocalArtifactStore) {
    let (app, storage, _) = test_app_with_recovery(status, secure_cookies).await;
    (app, storage)
}

async fn test_app_with_recovery(
    status: CheckStatus,
    secure_cookies: bool,
) -> (Router, LocalArtifactStore, Arc<TestRecoveryRepository>) {
    let auth = AuthService::new(Arc::new(TestAuthRepository::default()))
        .await
        .unwrap();
    let audit = AuditService::new(Arc::new(TestAuditRepository));
    let invitations = InvitationsService::new(Arc::new(TestInvitationsRepository::default()));
    let members = MembersService::new(Arc::new(TestMembersRepository));
    let projects = ProjectsService::new(Arc::new(TestProjectsRepository::default()));
    let recovery_repository = Arc::new(TestRecoveryRepository::default());
    let recovery = PasswordRecoveryService::new(
        recovery_repository.clone(),
        EnvelopeKeyRing::new(
            "test",
            vec![("test".to_owned(), SecretBox::new(Box::new([7_u8; 32])))],
        )
        .unwrap(),
    );
    let deployments = DeploymentsService::new(Arc::new(TestDeploymentsRepository::default()));
    let releases = ReleasesService::new(Arc::new(TestReleasesRepository));
    let tokens = ApiTokensService::new(Arc::new(TestApiTokensRepository::default()));
    let uploads = UploadsService::new(
        Arc::new(TestUploadsRepository::default()),
        UploadLimits::new(
            1_024 * 1_024,
            Duration::from_secs(600),
            Duration::from_secs(60),
        )
        .unwrap(),
    );
    let storage_root = tempfile::tempdir().unwrap();
    let storage = LocalArtifactStore::new(storage_root.path());
    storage.ensure_layout().await.unwrap();
    let app = build_router(AppState::new(
        Arc::new(Probe {
            status,
            _storage_root: storage_root,
        }),
        AppServices {
            auth,
            audit,
            deployments,
            invitations,
            members,
            projects,
            recovery,
            releases,
            tokens,
            uploads,
        },
        storage.clone(),
        BrowserPolicy::new(
            CookiePolicy::new(secure_cookies),
            CorsPolicy::try_new(vec!["http://127.0.0.1:4015".to_owned()]).unwrap(),
        ),
        AnonymousRequestPolicy::direct(),
    ));
    (app, storage, recovery_repository)
}

fn register_request_for(email: &str, display_name: &str) -> Request<Body> {
    Request::post("/_api/auth/register")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "email": email,
                "displayName": display_name,
                "password": "correct horse battery staple"
            })
            .to_string(),
        ))
        .unwrap()
}

fn register_request() -> Request<Body> {
    register_request_for("owner@example.com", "Owner")
}

fn password_reset_request(email: &str, peer: &str) -> Request<Body> {
    let mut request = Request::post("/_api/auth/password-resets")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "email": email }).to_string()))
        .unwrap();
    request.extensions_mut().insert(ConnectInfo(
        peer.parse::<SocketAddr>().expect("test peer is valid"),
    ));
    request
}

fn password_reset_confirmation(token: &str, peer: &str) -> Request<Body> {
    let mut request = Request::post("/_api/auth/password-resets/confirm")
        .header(header::CONTENT_TYPE, "application/json")
        .header(
            header::COOKIE,
            "zipship_session=old-session; zipship_csrf=old-csrf",
        )
        .body(Body::from(
            json!({
                "token": token,
                "password": "new correct horse battery staple"
            })
            .to_string(),
        ))
        .unwrap();
    request.extensions_mut().insert(ConnectInfo(
        peer.parse::<SocketAddr>().expect("test peer is valid"),
    ));
    request
}

fn response_cookie(response: &axum::response::Response, name: &str) -> String {
    response
        .headers()
        .get_all(header::SET_COOKIE)
        .iter()
        .filter_map(|value| value.to_str().ok())
        .find(|value| value.starts_with(&format!("{name}=")))
        .unwrap()
        .to_owned()
}

fn cookie_pair(set_cookie: &str) -> &str {
    set_cookie.split(';').next().unwrap()
}

fn cookie_value(set_cookie: &str) -> &str {
    cookie_pair(set_cookie).split_once('=').unwrap().1
}

async fn json_body(response: axum::response::Response) -> Value {
    serde_json::from_slice(&to_bytes(response.into_body(), 32 * 1_024).await.unwrap()).unwrap()
}

mod auth;
mod health_contract;
mod members_invitations;
mod projects;
mod release_operations;
mod tokens;
mod uploads;
