#![forbid(unsafe_code)]

use std::{error::Error, sync::Arc};
use tokio::sync::watch;
use tracing::{error, info, warn};
use tracing_subscriber::EnvFilter;
use uuid::Uuid;
use zipship_artifact::ArtifactLimits;
use zipship_config::Settings;
use zipship_jobs::{JobLease, WorkerId};
use zipship_mail::{MailWorkOutcome, PasswordResetMailWorker, SmtpPasswordResetMailer};
use zipship_postgres::{PgArtifactJobsRepository, PgJobsRepository, PgMailOutboxRepository};
use zipship_recovery::EnvelopeKeyRing;
use zipship_storage::LocalArtifactStore;
use zipship_worker::{ArtifactWorker, WorkOutcome};

#[derive(Debug, thiserror::Error)]
enum RunError {
    #[error("artifact worker failed")]
    Artifact(#[from] zipship_worker::WorkerError),
    #[error("password reset mail worker failed")]
    Mail(#[from] zipship_mail::MailWorkerError),
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error + Send + Sync>> {
    dotenvy::dotenv().ok();
    let settings = Settings::from_env()?;
    init_tracing(&settings.log_filter)?;
    let pool = zipship_postgres::connect(&settings).await?;
    zipship_postgres::check_ready(&pool).await?;
    let storage = LocalArtifactStore::new(&settings.storage_root);
    storage.ensure_layout().await?;
    storage.check_health().await?;
    let artifact_worker_id = WorkerId::parse(format!(
        "artifact:{}:{}",
        std::process::id(),
        Uuid::new_v4()
    ))?;
    let mail_worker_id =
        WorkerId::parse(format!("mail:{}:{}", std::process::id(), Uuid::new_v4()))?;
    let lease = JobLease::parse(settings.worker_lease_duration)?;
    let artifact_worker = ArtifactWorker::new(
        Arc::new(PgJobsRepository::new(pool.clone())),
        Arc::new(PgArtifactJobsRepository::new(pool.clone())),
        storage,
        artifact_worker_id.clone(),
        lease,
        ArtifactLimits {
            maximum_entries: settings.artifact_max_entries,
            maximum_file_bytes: settings.artifact_max_file_bytes,
            maximum_expanded_bytes: settings.artifact_max_expanded_bytes,
            maximum_path_depth: settings.artifact_max_path_depth,
            maximum_compression_ratio: settings.artifact_max_compression_ratio,
            compression_ratio_grace_bytes: settings.artifact_compression_ratio_grace_bytes,
        },
    );
    let recovery_keys = EnvelopeKeyRing::from_base64_config(
        settings.password_recovery_active_key_id.clone(),
        &settings.password_recovery_keys,
    )?;
    let mailer = SmtpPasswordResetMailer::new(&settings.smtp_url, &settings.smtp_from)?;
    let mail_worker = PasswordResetMailWorker::new(
        Arc::new(PgMailOutboxRepository::new(pool)),
        Arc::new(mailer),
        recovery_keys,
        settings.console_public_url.clone(),
        mail_worker_id.clone(),
        lease,
    );
    let (shutdown_sender, shutdown) = watch::channel(false);
    tokio::spawn(async move {
        if let Err(error) = shutdown_signal().await {
            error!(error = %error, "failed to install worker shutdown signal");
        }
        let _ = shutdown_sender.send(true);
    });
    info!(
        worker_id = artifact_worker_id.as_str(),
        "artifact worker started"
    );
    info!(worker_id = mail_worker_id.as_str(), "mail worker started");
    run_workers(
        artifact_worker,
        mail_worker,
        settings.worker_poll_interval,
        settings.worker_sweep_interval,
        shutdown,
    )
    .await?;
    info!(
        worker_id = artifact_worker_id.as_str(),
        "artifact worker stopped cleanly"
    );
    info!(
        worker_id = mail_worker_id.as_str(),
        "mail worker stopped cleanly"
    );
    Ok(())
}

async fn run_workers(
    artifact_worker: ArtifactWorker,
    mail_worker: PasswordResetMailWorker,
    poll_interval: std::time::Duration,
    sweep_interval: std::time::Duration,
    shutdown: watch::Receiver<bool>,
) -> Result<(), RunError> {
    let artifact_shutdown = shutdown.clone();
    tokio::try_join!(
        async move {
            run_artifact_worker(
                artifact_worker,
                poll_interval,
                sweep_interval,
                artifact_shutdown,
            )
            .await
            .map_err(RunError::Artifact)
        },
        async move {
            run_mail_worker(mail_worker, poll_interval, sweep_interval, shutdown)
                .await
                .map_err(RunError::Mail)
        },
    )?;
    Ok(())
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

async fn run_artifact_worker(
    worker: ArtifactWorker,
    poll_interval: std::time::Duration,
    sweep_interval: std::time::Duration,
    mut shutdown: watch::Receiver<bool>,
) -> Result<(), zipship_worker::WorkerError> {
    let mut next_sweep = tokio::time::Instant::now();
    loop {
        if *shutdown.borrow() {
            return Ok(());
        }
        if tokio::time::Instant::now() >= next_sweep {
            let recovered = worker.sweep_expired_leases().await?;
            if recovered > 0 {
                warn!(recovered, "recovered expired job leases");
            }
            next_sweep = tokio::time::Instant::now() + sweep_interval;
        }
        match worker.process_next().await? {
            WorkOutcome::Idle => {
                tokio::select! {
                    _ = tokio::time::sleep(poll_interval) => {}
                    changed = shutdown.changed() => {
                        if changed.is_err() || *shutdown.borrow() {
                            return Ok(());
                        }
                    }
                }
            }
            WorkOutcome::Completed {
                job_id,
                artifact_id,
                reused_artifact,
                cleanup_pending,
            } => info!(
                %job_id,
                %artifact_id,
                reused_artifact,
                cleanup_pending,
                "artifact job completed"
            ),
            WorkOutcome::RetryScheduled { job_id } => {
                warn!(%job_id, "artifact job scheduled for retry")
            }
            WorkOutcome::Failed { job_id } => {
                warn!(%job_id, "artifact job failed permanently")
            }
            WorkOutcome::LeaseLost { job_id } => {
                warn!(%job_id, "artifact job lease was lost before completion")
            }
        }
    }
}

async fn run_mail_worker(
    worker: PasswordResetMailWorker,
    poll_interval: std::time::Duration,
    sweep_interval: std::time::Duration,
    mut shutdown: watch::Receiver<bool>,
) -> Result<(), zipship_mail::MailWorkerError> {
    let mut next_sweep = tokio::time::Instant::now();
    loop {
        if *shutdown.borrow() {
            return Ok(());
        }
        if tokio::time::Instant::now() >= next_sweep {
            let recovered = worker.sweep().await?;
            if recovered > 0 {
                warn!(recovered, "recovered or expired password reset mail");
            }
            next_sweep = tokio::time::Instant::now() + sweep_interval;
        }
        match worker.process_next().await? {
            MailWorkOutcome::Idle => {
                tokio::select! {
                    _ = tokio::time::sleep(poll_interval) => {}
                    changed = shutdown.changed() => {
                        if changed.is_err() || *shutdown.borrow() {
                            return Ok(());
                        }
                    }
                }
            }
            MailWorkOutcome::Delivered { outbox_id } => {
                info!(%outbox_id, "password reset mail delivered")
            }
            MailWorkOutcome::RetryScheduled { outbox_id } => {
                warn!(%outbox_id, "password reset mail scheduled for retry")
            }
            MailWorkOutcome::Failed { outbox_id } => {
                warn!(%outbox_id, "password reset mail failed permanently")
            }
            MailWorkOutcome::LeaseLost { outbox_id } => {
                warn!(%outbox_id, "password reset mail lease was lost")
            }
        }
    }
}

fn init_tracing(filter: &str) -> Result<(), Box<dyn Error + Send + Sync>> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_new(filter)?)
        .json()
        .try_init()?;
    Ok(())
}
