use super::*;

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
