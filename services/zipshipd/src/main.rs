#![forbid(unsafe_code)]

use async_trait::async_trait;
use clap::{Parser, Subcommand};
use sqlx::PgPool;
use std::{collections::BTreeMap, error::Error, sync::Arc};
use tracing::{error, info};
use tracing_subscriber::EnvFilter;
use zipship_api::{AppState, CheckStatus, CookiePolicy, ReadinessProbe, build_router};
use zipship_auth::AuthService;
use zipship_config::{Environment, Settings};
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
    let app = build_router(AppState::new(
        readiness,
        auth,
        projects,
        uploads,
        storage,
        cookie_policy,
    ));
    let listener = tokio::net::TcpListener::bind(settings.http_bind).await?;

    info!(bind = %settings.http_bind, "zipshipd listening");
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;
    Ok(())
}

fn init_tracing(filter: &str) -> Result<(), Box<dyn Error + Send + Sync>> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_new(filter)?)
        .json()
        .try_init()?;
    Ok(())
}

async fn shutdown_signal() {
    if let Err(error) = tokio::signal::ctrl_c().await {
        error!(error = %error, "failed to install shutdown signal handler");
    }
}
