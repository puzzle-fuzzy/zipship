#![forbid(unsafe_code)]

use secrecy::ExposeSecret;
use sqlx::{PgPool, postgres::PgPoolOptions};
use std::time::Duration;
use zipship_config::Settings;

mod access;
mod artifact_jobs;
mod audit;
mod auth;
mod deployments;
mod invitations;
mod jobs;
mod mail;
mod members;
mod projects;
mod recovery;
mod releases;
mod tokens;
mod uploads;

pub use access::PgPreviewRepository;
pub use artifact_jobs::PgArtifactJobsRepository;
pub use audit::PgAuditRepository;
pub use auth::PgAuthRepository;
pub use deployments::PgDeploymentsRepository;
pub use invitations::PgInvitationsRepository;
pub use jobs::PgJobsRepository;
pub use mail::PgMailOutboxRepository;
pub use members::PgMembersRepository;
pub use projects::PgProjectsRepository;
pub use recovery::PgPasswordRecoveryRepository;
pub use releases::PgReleasesRepository;
pub use tokens::PgApiTokensRepository;
pub use uploads::PgUploadsRepository;

static MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!("./migrations");

pub async fn connect(settings: &Settings) -> Result<PgPool, sqlx::Error> {
    PgPoolOptions::new()
        .min_connections(1)
        .max_connections(settings.database_max_connections)
        .acquire_timeout(Duration::from_secs(10))
        .connect(settings.database_url.expose_secret())
        .await
}

pub fn connect_lazy(settings: &Settings) -> Result<PgPool, sqlx::Error> {
    PgPoolOptions::new()
        .min_connections(0)
        .max_connections(settings.database_max_connections)
        .acquire_timeout(Duration::from_secs(10))
        .connect_lazy(settings.database_url.expose_secret())
}

pub async fn migrate(pool: &PgPool) -> Result<(), sqlx::migrate::MigrateError> {
    MIGRATOR.run(pool).await
}

pub async fn check_ready(pool: &PgPool) -> Result<(), sqlx::Error> {
    sqlx::query("SELECT 1 FROM projects LIMIT 0")
        .execute(pool)
        .await?;
    Ok(())
}
