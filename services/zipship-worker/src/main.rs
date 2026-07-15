#![forbid(unsafe_code)]

use std::{error::Error, sync::Arc};
use tokio::sync::watch;
use tracing::{error, info, warn};
use tracing_subscriber::EnvFilter;
use uuid::Uuid;
use zipship_artifact::ArtifactLimits;
use zipship_config::Settings;
use zipship_jobs::{JobLease, WorkerId};
use zipship_postgres::{PgArtifactJobsRepository, PgJobsRepository};
use zipship_storage::LocalArtifactStore;
use zipship_worker::{ArtifactWorker, WorkOutcome};

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
    let worker_id = WorkerId::parse(format!(
        "artifact:{}:{}",
        std::process::id(),
        Uuid::new_v4()
    ))?;
    let lease = JobLease::parse(settings.worker_lease_duration)?;
    let worker = ArtifactWorker::new(
        Arc::new(PgJobsRepository::new(pool.clone())),
        Arc::new(PgArtifactJobsRepository::new(pool)),
        storage,
        worker_id.clone(),
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
    let (shutdown_sender, shutdown) = watch::channel(false);
    tokio::spawn(async move {
        if let Err(error) = shutdown_signal().await {
            error!(error = %error, "failed to install worker shutdown signal");
        }
        let _ = shutdown_sender.send(true);
    });
    info!(worker_id = worker_id.as_str(), "artifact worker started");
    run(
        worker,
        settings.worker_poll_interval,
        settings.worker_sweep_interval,
        shutdown,
    )
    .await?;
    info!(
        worker_id = worker_id.as_str(),
        "artifact worker stopped cleanly"
    );
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

async fn run(
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

fn init_tracing(filter: &str) -> Result<(), Box<dyn Error + Send + Sync>> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_new(filter)?)
        .json()
        .try_init()?;
    Ok(())
}
