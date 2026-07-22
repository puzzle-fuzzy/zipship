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
    ArtifactJobCompletion, ArtifactJobContext, ArtifactJobsRepositoryError, ArtifactReportLevel,
    ReadyArtifact,
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
    assert_eq!(artifact.detect_report.report_version, 1);
    assert_eq!(artifact.detect_report.level, ArtifactReportLevel::Warning);
    assert_eq!(artifact.detect_report.insights.assets.total_files, 2);
    assert_eq!(artifact.detect_report.insights.seo.score, 0);
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
