use serde_json::json;
use sqlx::{PgPool, postgres::PgPoolOptions};
use std::time::Duration;
use time::OffsetDateTime;
use zipship_domain::{JobKind, JobStatus};
use zipship_jobs::{JobLease, JobsRepository, NewJob, WorkerId};
use zipship_postgres::PgJobsRepository;

#[tokio::test]
#[ignore = "requires an isolated PostgreSQL database"]
async fn claims_jobs_once_and_recovers_expired_leases() {
    let pool = test_pool().await;
    zipship_postgres::migrate(&pool).await.unwrap();
    sqlx::query("TRUNCATE TABLE jobs")
        .execute(&pool)
        .await
        .unwrap();

    let repository = PgJobsRepository::new(pool.clone());
    let domain_id = uuid::Uuid::new_v4();
    let input = json!({ "uploadId": "00000000-0000-0000-0000-000000000001" });
    let job_id = repository
        .enqueue(NewJob {
            kind: JobKind::ArtifactProcess,
            domain_id: Some(domain_id),
            dedupe_key: Some("upload:1"),
            priority: 10,
            max_attempts: 3,
            input: &input,
        })
        .await
        .unwrap();
    let duplicate_id = repository
        .enqueue(NewJob {
            kind: JobKind::ArtifactProcess,
            domain_id: Some(domain_id),
            dedupe_key: Some("upload:1"),
            priority: 99,
            max_attempts: 9,
            input: &json!({ "ignored": true }),
        })
        .await
        .unwrap();
    assert_eq!(job_id, duplicate_id);

    let first_worker = WorkerId::parse("artifact-worker-1").unwrap();
    let competing_worker = WorkerId::parse("artifact-worker-2").unwrap();
    let lease = JobLease::parse(Duration::from_secs(60)).unwrap();
    let first_claim = repository.claim_next(&first_worker, &[JobKind::ArtifactProcess], lease);
    let competing_claim =
        repository.claim_next(&competing_worker, &[JobKind::ArtifactProcess], lease);
    let (first_claim, competing_claim) = tokio::join!(first_claim, competing_claim);
    let claimed = match (first_claim.unwrap(), competing_claim.unwrap()) {
        (Some(claimed), None) | (None, Some(claimed)) => claimed,
        result => panic!("exactly one worker must claim the job, got {result:?}"),
    };
    assert_eq!(claimed.id, job_id);
    assert_eq!(claimed.status, JobStatus::Running);
    assert_eq!(claimed.attempts, 1);

    let owner = WorkerId::parse(claimed.locked_by.clone().unwrap()).unwrap();
    let non_owner = if owner == first_worker {
        &competing_worker
    } else {
        &first_worker
    };
    assert!(
        !repository
            .heartbeat(job_id, non_owner, lease)
            .await
            .unwrap()
    );
    assert!(
        !repository
            .complete(job_id, non_owner, &json!({}))
            .await
            .unwrap()
    );

    sqlx::query("UPDATE jobs SET locked_until = now() - interval '1 second' WHERE id = $1")
        .bind(job_id)
        .execute(&pool)
        .await
        .unwrap();
    assert!(!repository.heartbeat(job_id, &owner, lease).await.unwrap());
    assert!(
        !repository
            .complete(job_id, &owner, &json!({}))
            .await
            .unwrap()
    );
    assert_eq!(repository.sweep_expired_leases().await.unwrap(), 1);

    let recovered: (String, String, OffsetDateTime) =
        sqlx::query_as("SELECT status, error_code, next_run_at FROM jobs WHERE id = $1")
            .bind(job_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(recovered.0, "queued");
    assert_eq!(recovered.1, "WORKER_LEASE_EXPIRED");
    assert!(recovered.2 > OffsetDateTime::now_utc());

    sqlx::query("UPDATE jobs SET next_run_at = now() - interval '1 second' WHERE id = $1")
        .bind(job_id)
        .execute(&pool)
        .await
        .unwrap();
    let retried = repository
        .claim_next(&competing_worker, &[JobKind::ArtifactProcess], lease)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(retried.attempts, 2);
    assert!(
        repository
            .fail(
                job_id,
                &competing_worker,
                "TRANSIENT_STORAGE_ERROR",
                &json!({ "recoverable": true }),
                Some(OffsetDateTime::now_utc() - time::Duration::seconds(1)),
            )
            .await
            .unwrap()
    );
    let final_claim = repository
        .claim_next(&first_worker, &[JobKind::ArtifactProcess], lease)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(final_claim.attempts, 3);
    assert!(
        repository
            .complete(job_id, &first_worker, &json!({ "artifactId": "ready" }))
            .await
            .unwrap()
    );
    let completed: (String, serde_json::Value) =
        sqlx::query_as("SELECT status, output_json FROM jobs WHERE id = $1")
            .bind(job_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(completed.0, "succeeded");
    assert_eq!(completed.1, json!({ "artifactId": "ready" }));
}

#[tokio::test]
#[ignore = "requires an isolated PostgreSQL database"]
async fn stops_retrying_at_the_attempt_limit() {
    let pool = test_pool().await;
    zipship_postgres::migrate(&pool).await.unwrap();
    sqlx::query("TRUNCATE TABLE jobs")
        .execute(&pool)
        .await
        .unwrap();

    let repository = PgJobsRepository::new(pool.clone());
    let domain_id = uuid::Uuid::new_v4();
    let job_id = repository
        .enqueue(NewJob {
            kind: JobKind::ArtifactProcess,
            domain_id: Some(domain_id),
            dedupe_key: None,
            priority: 0,
            max_attempts: 1,
            input: &json!({}),
        })
        .await
        .unwrap();
    let worker = WorkerId::parse("artifact-worker-terminal").unwrap();
    let lease = JobLease::parse(Duration::from_secs(60)).unwrap();
    repository
        .claim_next(&worker, &[JobKind::ArtifactProcess], lease)
        .await
        .unwrap()
        .unwrap();
    assert!(
        repository
            .fail(
                job_id,
                &worker,
                "INVALID_ARCHIVE",
                &json!({ "recoverable": false }),
                Some(OffsetDateTime::now_utc()),
            )
            .await
            .unwrap()
    );
    let status: String = sqlx::query_scalar("SELECT status FROM jobs WHERE id = $1")
        .bind(job_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(status, "failed");
}

async fn test_pool() -> PgPool {
    let database_url = std::env::var("ZIPSHIP_TEST_DATABASE_URL")
        .expect("ZIPSHIP_TEST_DATABASE_URL is required for PostgreSQL integration tests");
    PgPoolOptions::new()
        .max_connections(8)
        .connect(&database_url)
        .await
        .unwrap()
}
