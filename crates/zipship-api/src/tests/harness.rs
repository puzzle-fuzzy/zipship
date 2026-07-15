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

mod repositories;
