#![forbid(unsafe_code)]

use serde_json::json;
use std::{sync::Arc, time::Duration};
use thiserror::Error;
use time::OffsetDateTime;
use tokio::task::JoinError;
use tracing::warn;
use uuid::Uuid;
use zipship_artifact::{
    ArtifactError, ArtifactFailureOutcome, ArtifactJobsRepository, ArtifactJobsRepositoryError,
    ArtifactLimits, ExtractedArtifact, ReadyArtifact, extract_artifact,
};
use zipship_domain::{JobKind, JobStatus};
use zipship_jobs::{
    JobLease, JobRecord, JobsRepository, JobsRepositoryError, WorkerId, retry_delay,
};
use zipship_storage::{CommitOutcome, LocalArtifactStore, StorageError};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WorkOutcome {
    Idle,
    Completed {
        job_id: Uuid,
        artifact_id: Uuid,
        reused_artifact: bool,
        cleanup_pending: bool,
    },
    RetryScheduled {
        job_id: Uuid,
    },
    Failed {
        job_id: Uuid,
    },
    LeaseLost {
        job_id: Uuid,
    },
}

#[derive(Debug, Error)]
pub enum WorkerError {
    #[error("job queue operation failed")]
    Jobs(#[source] JobsRepositoryError),
    #[error("artifact state operation failed")]
    ArtifactState(#[source] ArtifactJobsRepositoryError),
}

#[derive(Clone)]
pub struct ArtifactWorker {
    jobs: Arc<dyn JobsRepository>,
    artifact_jobs: Arc<dyn ArtifactJobsRepository>,
    storage: LocalArtifactStore,
    worker_id: WorkerId,
    lease: JobLease,
    limits: ArtifactLimits,
}

impl ArtifactWorker {
    pub fn new(
        jobs: Arc<dyn JobsRepository>,
        artifact_jobs: Arc<dyn ArtifactJobsRepository>,
        storage: LocalArtifactStore,
        worker_id: WorkerId,
        lease: JobLease,
        limits: ArtifactLimits,
    ) -> Self {
        Self {
            jobs,
            artifact_jobs,
            storage,
            worker_id,
            lease,
            limits,
        }
    }

    pub async fn sweep_expired_leases(&self) -> Result<u64, WorkerError> {
        self.jobs
            .sweep_expired_leases()
            .await
            .map_err(WorkerError::Jobs)
    }

    pub async fn process_next(&self) -> Result<WorkOutcome, WorkerError> {
        let Some(job) = self
            .jobs
            .claim_next(&self.worker_id, &[JobKind::ArtifactProcess], self.lease)
            .await
            .map_err(WorkerError::Jobs)?
        else {
            return Ok(WorkOutcome::Idle);
        };
        self.process_claimed(job).await
    }

    async fn process_claimed(&self, job: JobRecord) -> Result<WorkOutcome, WorkerError> {
        if job.kind != JobKind::ArtifactProcess || job.status != JobStatus::Running {
            return self
                .record_failure(&job, "ARTIFACT_JOB_INVALID", false)
                .await;
        }
        let context = match self
            .artifact_jobs
            .load_context(job.id, &self.worker_id)
            .await
        {
            Ok(context) => context,
            Err(ArtifactJobsRepositoryError::LeaseLost) => {
                return Ok(WorkOutcome::LeaseLost { job_id: job.id });
            }
            Err(ArtifactJobsRepositoryError::InvalidContext)
            | Err(ArtifactJobsRepositoryError::ArtifactConflict) => {
                return self
                    .record_failure(&job, "ARTIFACT_CONTEXT_INVALID", false)
                    .await;
            }
            Err(error @ ArtifactJobsRepositoryError::Unavailable { .. }) => {
                return Err(WorkerError::ArtifactState(error));
            }
        };

        let archive_path = self.storage.upload_archive_path(context.upload_id);
        let work_path = self
            .storage
            .artifact_work_path(context.upload_id, job.id, job.attempts);
        let limits = self.limits;
        let extraction = tokio::task::spawn_blocking(move || {
            extract_artifact(&archive_path, &work_path, limits)
        });
        let extracted = match self
            .await_extraction_with_heartbeat(job.id, extraction)
            .await
        {
            Ok(extracted) => extracted,
            Err(ProcessingError::Artifact(error)) => {
                return self
                    .record_failure(&job, error.code(), error.retryable())
                    .await;
            }
            Err(ProcessingError::TaskJoin) => {
                return self
                    .record_failure(&job, "ARTIFACT_PROCESSOR_PANIC", true)
                    .await;
            }
            Err(ProcessingError::LeaseLost) => {
                return Ok(WorkOutcome::LeaseLost { job_id: job.id });
            }
            Err(ProcessingError::Heartbeat(error)) => return Err(WorkerError::Jobs(error)),
        };

        if !self
            .jobs
            .heartbeat(job.id, &self.worker_id, self.lease)
            .await
            .map_err(WorkerError::Jobs)?
        {
            cleanup_work_directory(&extracted);
            return Ok(WorkOutcome::LeaseLost { job_id: job.id });
        }
        let commit = self
            .storage
            .commit_artifact_directory(&extracted.root, &extracted.digest)
            .await;
        let commit = match commit {
            Ok(commit) => commit,
            Err(error) => {
                cleanup_work_directory(&extracted);
                let retryable = matches!(error, StorageError::Io(_));
                return self
                    .record_failure(&job, storage_error_code(&error), retryable)
                    .await;
            }
        };
        if !self
            .jobs
            .heartbeat(job.id, &self.worker_id, self.lease)
            .await
            .map_err(WorkerError::Jobs)?
        {
            return Ok(WorkOutcome::LeaseLost { job_id: job.id });
        }

        let storage_key = LocalArtifactStore::artifact_storage_key(&extracted.digest);
        let ready = ReadyArtifact {
            digest: extracted.digest,
            storage_key,
            manifest: extracted.manifest,
            file_count: extracted.file_count,
            total_size: extracted.total_size,
        };
        let completion = match self
            .artifact_jobs
            .complete_artifact_job(&context, &self.worker_id, &ready)
            .await
        {
            Ok(completion) => completion,
            Err(ArtifactJobsRepositoryError::LeaseLost) => {
                return Ok(WorkOutcome::LeaseLost { job_id: job.id });
            }
            Err(ArtifactJobsRepositoryError::InvalidContext) => {
                return self
                    .record_failure(&job, "ARTIFACT_CONTEXT_INVALID", false)
                    .await;
            }
            Err(ArtifactJobsRepositoryError::ArtifactConflict) => {
                return self
                    .record_failure(&job, "ARTIFACT_DIGEST_CONFLICT", false)
                    .await;
            }
            Err(error @ ArtifactJobsRepositoryError::Unavailable { .. }) => {
                return Err(WorkerError::ArtifactState(error));
            }
        };
        let cleanup_pending = match self.storage.remove_upload_staging(context.upload_id).await {
            Ok(()) => false,
            Err(error) => {
                warn!(
                    upload_id = %context.upload_id,
                    job_id = %job.id,
                    error = %error,
                    "artifact completed but upload staging cleanup failed"
                );
                true
            }
        };
        Ok(WorkOutcome::Completed {
            job_id: job.id,
            artifact_id: completion.artifact_id,
            reused_artifact: completion.reused_artifact
                || matches!(commit, CommitOutcome::AlreadyExists),
            cleanup_pending,
        })
    }

    async fn await_extraction_with_heartbeat(
        &self,
        job_id: Uuid,
        mut extraction: tokio::task::JoinHandle<Result<ExtractedArtifact, ArtifactError>>,
    ) -> Result<ExtractedArtifact, ProcessingError> {
        let heartbeat_millis = (self.lease.duration().as_millis() / 3).max(100);
        let heartbeat_interval = Duration::from_millis(
            u64::try_from(heartbeat_millis).expect("validated lease interval fits in u64"),
        );
        let mut heartbeat = tokio::time::interval_at(
            tokio::time::Instant::now() + heartbeat_interval,
            heartbeat_interval,
        );
        heartbeat.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        loop {
            tokio::select! {
                result = &mut extraction => {
                    return result
                        .map_err(|_error: JoinError| ProcessingError::TaskJoin)?
                        .map_err(ProcessingError::Artifact);
                }
                _ = heartbeat.tick() => {
                    let owned = match self.jobs
                        .heartbeat(job_id, &self.worker_id, self.lease)
                        .await
                    {
                        Ok(owned) => owned,
                        Err(error) => {
                            let _ = extraction.await;
                            return Err(ProcessingError::Heartbeat(error));
                        }
                    };
                    if !owned {
                        let _ = extraction.await;
                        return Err(ProcessingError::LeaseLost);
                    }
                }
            }
        }
    }

    async fn record_failure(
        &self,
        job: &JobRecord,
        error_code: &'static str,
        retryable: bool,
    ) -> Result<WorkOutcome, WorkerError> {
        let retry_at = retryable.then(|| {
            let delay = retry_delay(u32::try_from(job.attempts).unwrap_or(u32::MAX));
            OffsetDateTime::now_utc()
                + time::Duration::seconds(
                    i64::try_from(delay.as_secs()).expect("retry delay always fits in i64"),
                )
        });
        let outcome = self
            .artifact_jobs
            .fail_artifact_job(
                job.id,
                &self.worker_id,
                error_code,
                &json!({ "recoverable": retryable }),
                retry_at,
            )
            .await;
        match outcome {
            Ok(ArtifactFailureOutcome::RetryScheduled) => {
                Ok(WorkOutcome::RetryScheduled { job_id: job.id })
            }
            Ok(ArtifactFailureOutcome::Terminal) => {
                if let Some(upload_id) = job.domain_id {
                    let _ = self.storage.remove_upload_staging(upload_id).await;
                }
                Ok(WorkOutcome::Failed { job_id: job.id })
            }
            Err(ArtifactJobsRepositoryError::LeaseLost) => {
                Ok(WorkOutcome::LeaseLost { job_id: job.id })
            }
            Err(error) => Err(WorkerError::ArtifactState(error)),
        }
    }
}

#[derive(Debug)]
enum ProcessingError {
    Artifact(ArtifactError),
    TaskJoin,
    LeaseLost,
    Heartbeat(JobsRepositoryError),
}

fn cleanup_work_directory(extracted: &ExtractedArtifact) {
    let mut path = extracted.root.as_path();
    while let Some(parent) = path.parent() {
        if parent
            .file_name()
            .is_some_and(|name| name.to_string_lossy().starts_with("expanded-"))
        {
            let _ = std::fs::remove_dir_all(parent);
            return;
        }
        path = parent;
    }
    let _ = std::fs::remove_dir_all(&extracted.root);
}

fn storage_error_code(error: &StorageError) -> &'static str {
    match error {
        StorageError::Io(_) => "ARTIFACT_STORAGE_FAILURE",
        StorageError::InvalidStagingPath
        | StorageError::InvalidStagingDirectory
        | StorageError::InvalidArtifactPath
        | StorageError::InvalidArtifactDirectory
        | StorageError::InvalidArtifactFile => "ARTIFACT_STORAGE_INVARIANT_FAILED",
        StorageError::UploadTooLarge { .. } | StorageError::UploadSizeMismatch { .. } => {
            "ARTIFACT_STORAGE_INVARIANT_FAILED"
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use async_trait::async_trait;
    use serde_json::Value;
    use std::{
        fs::File,
        io::Write,
        sync::{Arc, Mutex},
    };
    use tempfile::tempdir;
    use zip::{CompressionMethod, ZipWriter, write::SimpleFileOptions};
    use zipship_artifact::{
        ArtifactJobCompletion, ArtifactJobContext, ArtifactJobsRepositoryError, ReadyArtifact,
    };
    use zipship_jobs::{JobLease, NewJob};

    #[derive(Default)]
    struct JobState {
        job: Option<JobRecord>,
        heartbeats: usize,
    }

    #[derive(Default)]
    struct TestJobsRepository {
        state: Mutex<JobState>,
    }

    #[async_trait]
    impl JobsRepository for TestJobsRepository {
        async fn enqueue(&self, _job: NewJob<'_>) -> Result<Uuid, JobsRepositoryError> {
            unreachable!("worker tests do not enqueue jobs")
        }

        async fn claim_next(
            &self,
            worker_id: &WorkerId,
            _supported_kinds: &[JobKind],
            lease: JobLease,
        ) -> Result<Option<JobRecord>, JobsRepositoryError> {
            let mut state = self.state.lock().unwrap();
            let Some(mut job) = state.job.take() else {
                return Ok(None);
            };
            job.status = JobStatus::Running;
            job.locked_by = Some(worker_id.as_str().to_owned());
            job.locked_until =
                Some(OffsetDateTime::now_utc() + time::Duration::seconds(lease.seconds()));
            Ok(Some(job))
        }

        async fn heartbeat(
            &self,
            _job_id: Uuid,
            _worker_id: &WorkerId,
            _lease: JobLease,
        ) -> Result<bool, JobsRepositoryError> {
            self.state.lock().unwrap().heartbeats += 1;
            Ok(true)
        }

        async fn complete(
            &self,
            _job_id: Uuid,
            _worker_id: &WorkerId,
            _output: &Value,
        ) -> Result<bool, JobsRepositoryError> {
            unreachable!("artifact completion uses its transactional repository")
        }

        async fn fail(
            &self,
            _job_id: Uuid,
            _worker_id: &WorkerId,
            _error_code: &str,
            _error_detail: &Value,
            _retry_at: Option<OffsetDateTime>,
        ) -> Result<bool, JobsRepositoryError> {
            unreachable!("artifact failure uses its transactional repository")
        }

        async fn sweep_expired_leases(&self) -> Result<u64, JobsRepositoryError> {
            Ok(0)
        }
    }

    struct ArtifactState {
        context: ArtifactJobContext,
        completed: Option<ReadyArtifact>,
        failure: Option<(String, bool)>,
    }

    struct TestArtifactJobsRepository {
        state: Mutex<ArtifactState>,
    }

    #[async_trait]
    impl ArtifactJobsRepository for TestArtifactJobsRepository {
        async fn load_context(
            &self,
            _job_id: Uuid,
            _worker_id: &WorkerId,
        ) -> Result<ArtifactJobContext, ArtifactJobsRepositoryError> {
            Ok(self.state.lock().unwrap().context.clone())
        }

        async fn complete_artifact_job(
            &self,
            _context: &ArtifactJobContext,
            _worker_id: &WorkerId,
            artifact: &ReadyArtifact,
        ) -> Result<ArtifactJobCompletion, ArtifactJobsRepositoryError> {
            self.state.lock().unwrap().completed = Some(artifact.clone());
            Ok(ArtifactJobCompletion {
                artifact_id: Uuid::new_v4(),
                reused_artifact: false,
            })
        }

        async fn fail_artifact_job(
            &self,
            _job_id: Uuid,
            _worker_id: &WorkerId,
            error_code: &str,
            _error_detail: &Value,
            retry_at: Option<OffsetDateTime>,
        ) -> Result<ArtifactFailureOutcome, ArtifactJobsRepositoryError> {
            let retryable = retry_at.is_some();
            self.state.lock().unwrap().failure = Some((error_code.to_owned(), retryable));
            Ok(if retryable {
                ArtifactFailureOutcome::RetryScheduled
            } else {
                ArtifactFailureOutcome::Terminal
            })
        }
    }

    #[tokio::test]
    async fn processes_a_claimed_archive_into_an_immutable_blob() {
        let fixture = fixture().await;
        write_site_zip(&fixture.storage.upload_archive_path(fixture.upload_id));
        let outcome = fixture.worker.process_next().await.unwrap();
        let WorkOutcome::Completed {
            artifact_id: _,
            reused_artifact: false,
            cleanup_pending: false,
            ..
        } = outcome
        else {
            panic!("expected a completed artifact, got {outcome:?}");
        };
        let artifact = fixture
            .artifact_jobs
            .state
            .lock()
            .unwrap()
            .completed
            .clone()
            .unwrap();
        assert_eq!(artifact.file_count, 2);
        assert_eq!(
            std::fs::read_to_string(
                fixture
                    .storage
                    .artifact_path(&artifact.digest)
                    .join("index.html"),
            )
            .unwrap(),
            "<main>ready</main>",
        );
        assert!(
            !fixture
                .storage
                .upload_staging_path(fixture.upload_id)
                .exists()
        );
        assert!(fixture.jobs.state.lock().unwrap().heartbeats >= 2);
    }

    #[tokio::test]
    async fn records_invalid_archives_as_terminal_failures() {
        let fixture = fixture().await;
        std::fs::write(
            fixture.storage.upload_archive_path(fixture.upload_id),
            b"not a ZIP archive",
        )
        .unwrap();
        assert!(matches!(
            fixture.worker.process_next().await.unwrap(),
            WorkOutcome::Failed { .. },
        ));
        assert_eq!(
            fixture.artifact_jobs.state.lock().unwrap().failure.as_ref(),
            Some(&("INVALID_ZIP_ARCHIVE".to_owned(), false)),
        );
        assert!(
            !fixture
                .storage
                .upload_staging_path(fixture.upload_id)
                .exists()
        );
    }

    struct Fixture {
        worker: ArtifactWorker,
        jobs: Arc<TestJobsRepository>,
        artifact_jobs: Arc<TestArtifactJobsRepository>,
        storage: LocalArtifactStore,
        upload_id: Uuid,
        _temp: tempfile::TempDir,
    }

    async fn fixture() -> Fixture {
        let temp = tempdir().unwrap();
        let storage = LocalArtifactStore::new(temp.path());
        storage.ensure_layout().await.unwrap();
        let job_id = Uuid::new_v4();
        let upload_id = Uuid::new_v4();
        let project_id = Uuid::new_v4();
        let release_id = Uuid::new_v4();
        std::fs::create_dir_all(storage.upload_staging_path(upload_id)).unwrap();
        let jobs = Arc::new(TestJobsRepository::default());
        jobs.state.lock().unwrap().job = Some(JobRecord {
            id: job_id,
            kind: JobKind::ArtifactProcess,
            domain_id: Some(upload_id),
            status: JobStatus::Queued,
            priority: 10,
            attempts: 1,
            max_attempts: 5,
            next_run_at: OffsetDateTime::now_utc(),
            locked_by: None,
            locked_until: None,
            heartbeat_at: None,
            input: json!({}),
            output: None,
            error_code: None,
        });
        let artifact_jobs = Arc::new(TestArtifactJobsRepository {
            state: Mutex::new(ArtifactState {
                context: ArtifactJobContext {
                    job_id,
                    upload_id,
                    project_id,
                    release_id,
                },
                completed: None,
                failure: None,
            }),
        });
        let worker_id = WorkerId::parse("artifact-worker-test").unwrap();
        let worker = ArtifactWorker::new(
            jobs.clone(),
            artifact_jobs.clone(),
            storage.clone(),
            worker_id,
            JobLease::parse(Duration::from_secs(60)).unwrap(),
            ArtifactLimits::default(),
        );
        Fixture {
            worker,
            jobs,
            artifact_jobs,
            storage,
            upload_id,
            _temp: temp,
        }
    }

    fn write_site_zip(path: &std::path::Path) {
        let file = File::create(path).unwrap();
        let mut writer = ZipWriter::new(file);
        let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
        writer.start_file("site/index.html", options).unwrap();
        writer.write_all(b"<main>ready</main>").unwrap();
        writer.start_file("site/assets/app.js", options).unwrap();
        writer.write_all(b"console.log('ready')").unwrap();
        writer.finish().unwrap();
    }
}
