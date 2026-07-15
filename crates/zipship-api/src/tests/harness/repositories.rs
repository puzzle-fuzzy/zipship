use super::*;

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

mod projects;
use projects::TestProjectsRepository;

mod members_invitations;
use members_invitations::{TestInvitationsRepository, TestMembersRepository};

mod tokens;
use tokens::TestApiTokensRepository;

mod recovery;
use recovery::TestRecoveryRepository;

mod uploads;
use uploads::TestUploadsRepository;

mod release_operations;
use release_operations::{TestAuditRepository, TestDeploymentsRepository, TestReleasesRepository};

mod auth;
use auth::TestAuthRepository;

mod app;
