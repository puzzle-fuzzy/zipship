#![forbid(unsafe_code)]

use async_trait::async_trait;
use clap::{Parser, Subcommand};
use sqlx::PgPool;
use std::{collections::BTreeMap, error::Error, sync::Arc};
use tokio::sync::watch;
use tracing::{error, info};
use tracing_subscriber::EnvFilter;
use zipship_access::PreviewService;
use zipship_api::{AppState, CheckStatus, CookiePolicy, ReadinessProbe, build_router};
use zipship_auth::AuthService;
use zipship_config::{Environment, Settings};
use zipship_deployments::DeploymentsService;
use zipship_projects::ProjectsService;
use zipship_storage::LocalArtifactStore;
use zipship_uploads::{UploadLimits, UploadsService};

#[derive(Debug, Parser)]
#[command(name = "zipshipd", version, about = "ZipShip control and access plane")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Debug, Subcommand)]
enum Command {
    /// Apply all pending PostgreSQL migrations and exit.
    Migrate,
    /// Start the control and access plane HTTP server.
    Serve,
}

#[derive(Clone)]
struct SystemReadiness {
    pool: PgPool,
    storage: LocalArtifactStore,
}

#[async_trait]
impl ReadinessProbe for SystemReadiness {
    async fn check(&self) -> BTreeMap<String, CheckStatus> {
        let database = match zipship_postgres::check_ready(&self.pool).await {
            Ok(()) => CheckStatus::Ok,
            Err(error) => {
                error!(error = %error, "database readiness check failed");
                CheckStatus::Failed
            }
        };
        let storage = match self.storage.check_health().await {
            Ok(()) => CheckStatus::Ok,
            Err(error) => {
                error!(error = %error, "storage readiness check failed");
                CheckStatus::Failed
            }
        };
        BTreeMap::from([
            ("database".to_owned(), database),
            ("storage".to_owned(), storage),
        ])
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error + Send + Sync>> {
    let cli = Cli::parse();
    dotenvy::dotenv().ok();
    let settings = Settings::from_env()?;
    init_tracing(&settings.log_filter)?;

    match cli.command {
        Command::Migrate => {
            let pool = zipship_postgres::connect(&settings).await?;
            zipship_postgres::migrate(&pool).await?;
            info!("database migrations completed");
        }
        Command::Serve => {
            let pool = zipship_postgres::connect_lazy(&settings)?;
            serve(settings, pool).await?;
        }
    }
    Ok(())
}

async fn serve(settings: Settings, pool: PgPool) -> Result<(), Box<dyn Error + Send + Sync>> {
    let storage = LocalArtifactStore::new(&settings.storage_root);
    storage.ensure_layout().await?;

    let readiness = Arc::new(SystemReadiness {
        pool: pool.clone(),
        storage: storage.clone(),
    });
    let auth = AuthService::new(Arc::new(zipship_postgres::PgAuthRepository::new(pool))).await?;
    let projects = ProjectsService::new(Arc::new(zipship_postgres::PgProjectsRepository::new(
        readiness.pool.clone(),
    )));
    let deployments = DeploymentsService::new(Arc::new(
        zipship_postgres::PgDeploymentsRepository::new(readiness.pool.clone()),
    ));
    let uploads = UploadsService::new(
        Arc::new(zipship_postgres::PgUploadsRepository::new(
            readiness.pool.clone(),
        )),
        UploadLimits {
            maximum_bytes: settings.upload_max_bytes,
            upload_ttl: settings.upload_ttl,
            receive_lease: settings.upload_receive_lease,
        },
    );
    let cookie_policy = CookiePolicy::new(settings.environment == Environment::Production);
    let access_app = zipship_access::build_router(PreviewService::new(
        Arc::new(zipship_postgres::PgPreviewRepository::new(
            readiness.pool.clone(),
        )),
        storage.clone(),
    ));
    let control_app = build_router(AppState::new(
        readiness,
        auth,
        deployments,
        projects,
        uploads,
        storage,
        cookie_policy,
    ));
    let control_listener = tokio::net::TcpListener::bind(settings.http_bind).await?;
    let access_listener = tokio::net::TcpListener::bind(settings.access_bind).await?;
    let (shutdown_sender, _) = watch::channel(false);
    let signal_sender = shutdown_sender.clone();
    let signal_task = tokio::spawn(async move {
        if let Err(error) = shutdown_signal().await {
            error!(error = %error, "failed to install server shutdown signal");
        }
        let _ = signal_sender.send(true);
    });

    info!(bind = %settings.http_bind, "ZipShip control plane listening");
    info!(bind = %settings.access_bind, "ZipShip access plane listening");
    let control_server = axum::serve(control_listener, control_app)
        .with_graceful_shutdown(wait_for_shutdown(shutdown_sender.subscribe()));
    let access_server = axum::serve(access_listener, access_app)
        .with_graceful_shutdown(wait_for_shutdown(shutdown_sender.subscribe()));
    let result = tokio::try_join!(control_server, access_server);
    signal_task.abort();
    result?;
    Ok(())
}

fn init_tracing(filter: &str) -> Result<(), Box<dyn Error + Send + Sync>> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_new(filter)?)
        .json()
        .try_init()?;
    Ok(())
}

async fn wait_for_shutdown(mut shutdown: watch::Receiver<bool>) {
    if !*shutdown.borrow() {
        let _ = shutdown.changed().await;
    }
}

#[cfg(unix)]
async fn shutdown_signal() -> Result<(), std::io::Error> {
    use tokio::signal::unix::{SignalKind, signal};

    let mut terminate = signal(SignalKind::terminate())?;
    tokio::select! {
        result = tokio::signal::ctrl_c() => result,
        _ = terminate.recv() => Ok(()),
    }
}

#[cfg(not(unix))]
async fn shutdown_signal() -> Result<(), std::io::Error> {
    tokio::signal::ctrl_c().await
}
