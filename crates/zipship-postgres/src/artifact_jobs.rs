use async_trait::async_trait;
use serde_json::{Value, json};
use sqlx::{FromRow, PgPool, Postgres, Transaction};
use time::OffsetDateTime;
use uuid::Uuid;
use zipship_artifact::{
    ArtifactFailureOutcome, ArtifactJobCompletion, ArtifactJobContext, ArtifactJobsRepository,
    ArtifactJobsRepositoryError, ReadyArtifact,
};
use zipship_jobs::WorkerId;

#[derive(Debug, Clone)]
pub struct PgArtifactJobsRepository {
    pool: PgPool,
}

impl PgArtifactJobsRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl ArtifactJobsRepository for PgArtifactJobsRepository {
    async fn load_context(
        &self,
        job_id: Uuid,
        worker_id: &WorkerId,
    ) -> Result<ArtifactJobContext, ArtifactJobsRepositoryError> {
        let upload_id = owned_artifact_job(&self.pool, job_id, worker_id)
            .await?
            .ok_or(ArtifactJobsRepositoryError::LeaseLost)?;
        let row = sqlx::query_as::<_, ContextRow>(
            r#"
            SELECT
                uploads.id AS upload_id,
                uploads.project_id,
                uploads.release_id,
                uploads.staging_key
            FROM uploads
            INNER JOIN releases
                ON releases.id = uploads.release_id
               AND releases.project_id = uploads.project_id
            WHERE uploads.id = $1
              AND uploads.state = 'processing'
              AND releases.state = 'processing'
            "#,
        )
        .bind(upload_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(ArtifactJobsRepositoryError::unavailable)?
        .ok_or(ArtifactJobsRepositoryError::InvalidContext)?;
        row.try_into_context(job_id)
    }

    async fn complete_artifact_job(
        &self,
        context: &ArtifactJobContext,
        worker_id: &WorkerId,
        artifact: &ReadyArtifact,
    ) -> Result<ArtifactJobCompletion, ArtifactJobsRepositoryError> {
        validate_ready_artifact(artifact)?;
        let file_count = i32::try_from(artifact.file_count)
            .map_err(|_| ArtifactJobsRepositoryError::ArtifactConflict)?;
        let total_size = i64::try_from(artifact.total_size)
            .map_err(|_| ArtifactJobsRepositoryError::ArtifactConflict)?;
        let manifest = serde_json::to_value(&artifact.manifest)
            .map_err(ArtifactJobsRepositoryError::unavailable)?;
        let mut transaction = self
            .pool
            .begin()
            .await
            .map_err(ArtifactJobsRepositoryError::unavailable)?;
        let upload_id = lock_owned_artifact_job(&mut transaction, context.job_id, worker_id)
            .await?
            .ok_or(ArtifactJobsRepositoryError::LeaseLost)?;
        if upload_id != context.upload_id {
            return Err(ArtifactJobsRepositoryError::InvalidContext);
        }
        let locked_context = lock_processing_context(&mut transaction, upload_id)
            .await?
            .ok_or(ArtifactJobsRepositoryError::InvalidContext)?;
        let locked_context = locked_context.try_into_context(context.job_id)?;
        if &locked_context != context {
            return Err(ArtifactJobsRepositoryError::InvalidContext);
        }

        let artifact_id = Uuid::new_v4();
        let inserted_id = sqlx::query_scalar::<_, Uuid>(
            r#"
            INSERT INTO artifacts (
                id, sha256, storage_key, state, file_count, total_size,
                manifest, detect_report, ready_at
            )
            VALUES (
                $1, $2, $3, 'ready', $4, $5, $6,
                jsonb_build_object('entryPoint', 'index.html', 'manifestVersion', 1),
                now()
            )
            ON CONFLICT (sha256) DO NOTHING
            RETURNING id
            "#,
        )
        .bind(artifact_id)
        .bind(artifact.digest.as_str())
        .bind(&artifact.storage_key)
        .bind(file_count)
        .bind(total_size)
        .bind(&manifest)
        .fetch_optional(&mut *transaction)
        .await
        .map_err(ArtifactJobsRepositoryError::unavailable)?;
        let (artifact_id, reused_artifact) = match inserted_id {
            Some(artifact_id) => (artifact_id, false),
            None => {
                let existing = sqlx::query_as::<_, ExistingArtifactRow>(
                    r#"
                    SELECT id, storage_key, state, file_count, total_size, manifest
                    FROM artifacts
                    WHERE sha256 = $1
                    FOR UPDATE
                    "#,
                )
                .bind(artifact.digest.as_str())
                .fetch_one(&mut *transaction)
                .await
                .map_err(ArtifactJobsRepositoryError::unavailable)?;
                if existing.state != "ready"
                    || existing.storage_key != artifact.storage_key
                    || existing.file_count != file_count
                    || existing.total_size != total_size
                    || existing.manifest != manifest
                {
                    return Err(ArtifactJobsRepositoryError::ArtifactConflict);
                }
                (existing.id, true)
            }
        };

        let release = sqlx::query(
            r#"
            UPDATE releases
            SET artifact_id = $2,
                state = 'ready',
                ready_at = now(),
                failure_code = NULL,
                failure_detail = NULL
            WHERE id = $1 AND state = 'processing'
            "#,
        )
        .bind(context.release_id)
        .bind(artifact_id)
        .execute(&mut *transaction)
        .await
        .map_err(ArtifactJobsRepositoryError::unavailable)?;
        let upload = sqlx::query(
            r#"
            UPDATE uploads
            SET state = 'completed',
                completed_at = now(),
                error_code = NULL,
                updated_at = now()
            WHERE id = $1 AND state = 'processing'
            "#,
        )
        .bind(context.upload_id)
        .execute(&mut *transaction)
        .await
        .map_err(ArtifactJobsRepositoryError::unavailable)?;
        let job = sqlx::query(
            r#"
            UPDATE jobs
            SET status = 'succeeded',
                output_json = $3,
                error_code = NULL,
                error_detail = NULL,
                finished_at = now(),
                locked_by = NULL,
                locked_until = NULL,
                heartbeat_at = NULL
            WHERE id = $1
              AND status = 'running'
              AND locked_by = $2
              AND locked_until > now()
            "#,
        )
        .bind(context.job_id)
        .bind(worker_id.as_str())
        .bind(json!({
            "artifactId": artifact_id,
            "sha256": artifact.digest.as_str(),
            "reusedArtifact": reused_artifact,
        }))
        .execute(&mut *transaction)
        .await
        .map_err(ArtifactJobsRepositoryError::unavailable)?;
        if release.rows_affected() != 1 || upload.rows_affected() != 1 || job.rows_affected() != 1 {
            return Err(ArtifactJobsRepositoryError::LeaseLost);
        }

        let audit = sqlx::query(
            r#"
            INSERT INTO audit_logs (
                organization_id, project_id, actor_id, action,
                target_type, target_id, metadata
            )
            SELECT
                projects.organization_id,
                projects.id,
                uploads.created_by,
                'upload.processing_completed',
                'upload',
                uploads.id,
                $3
            FROM uploads
            INNER JOIN projects ON projects.id = uploads.project_id
            WHERE uploads.id = $1 AND projects.id = $2
            "#,
        )
        .bind(context.upload_id)
        .bind(context.project_id)
        .bind(json!({
            "artifactId": artifact_id,
            "releaseId": context.release_id,
            "sha256": artifact.digest.as_str(),
            "reusedArtifact": reused_artifact,
        }))
        .execute(&mut *transaction)
        .await
        .map_err(ArtifactJobsRepositoryError::unavailable)?;
        if audit.rows_affected() != 1 {
            return Err(ArtifactJobsRepositoryError::InvalidContext);
        }

        transaction
            .commit()
            .await
            .map_err(ArtifactJobsRepositoryError::unavailable)?;
        Ok(ArtifactJobCompletion {
            artifact_id,
            reused_artifact,
        })
    }

    async fn fail_artifact_job(
        &self,
        job_id: Uuid,
        worker_id: &WorkerId,
        error_code: &str,
        error_detail: &Value,
        retry_at: Option<OffsetDateTime>,
    ) -> Result<ArtifactFailureOutcome, ArtifactJobsRepositoryError> {
        let mut transaction = self
            .pool
            .begin()
            .await
            .map_err(ArtifactJobsRepositoryError::unavailable)?;
        let job = sqlx::query_as::<_, FailureJobRow>(
            r#"
            SELECT domain_id, attempts, max_attempts
            FROM jobs
            WHERE id = $1
              AND kind = 'artifact.process'
              AND status = 'running'
              AND locked_by = $2
              AND locked_until > now()
            FOR UPDATE
            "#,
        )
        .bind(job_id)
        .bind(worker_id.as_str())
        .fetch_optional(&mut *transaction)
        .await
        .map_err(ArtifactJobsRepositoryError::unavailable)?
        .ok_or(ArtifactJobsRepositoryError::LeaseLost)?;
        let terminal = retry_at.is_none() || job.attempts >= job.max_attempts;
        sqlx::query(
            r#"
            UPDATE jobs
            SET status = CASE WHEN $5 THEN 'failed' ELSE 'queued' END,
                next_run_at = CASE WHEN $5 THEN next_run_at ELSE $6 END,
                error_code = $3,
                error_detail = $4,
                finished_at = CASE WHEN $5 THEN now() ELSE NULL END,
                locked_by = NULL,
                locked_until = NULL,
                heartbeat_at = NULL
            WHERE id = $1 AND status = 'running' AND locked_by = $2
            "#,
        )
        .bind(job_id)
        .bind(worker_id.as_str())
        .bind(error_code)
        .bind(error_detail)
        .bind(terminal)
        .bind(retry_at)
        .execute(&mut *transaction)
        .await
        .map_err(ArtifactJobsRepositoryError::unavailable)?;

        if terminal && let Some(upload_id) = job.domain_id {
            fail_processing_domain(&mut transaction, upload_id, error_code, error_detail).await?;
        }
        transaction
            .commit()
            .await
            .map_err(ArtifactJobsRepositoryError::unavailable)?;
        Ok(if terminal {
            ArtifactFailureOutcome::Terminal
        } else {
            ArtifactFailureOutcome::RetryScheduled
        })
    }
}

async fn owned_artifact_job(
    pool: &PgPool,
    job_id: Uuid,
    worker_id: &WorkerId,
) -> Result<Option<Uuid>, ArtifactJobsRepositoryError> {
    sqlx::query_scalar(
        r#"
        SELECT domain_id
        FROM jobs
        WHERE id = $1
          AND kind = 'artifact.process'
          AND status = 'running'
          AND locked_by = $2
          AND locked_until > now()
        "#,
    )
    .bind(job_id)
    .bind(worker_id.as_str())
    .fetch_optional(pool)
    .await
    .map_err(ArtifactJobsRepositoryError::unavailable)
}

async fn lock_owned_artifact_job(
    transaction: &mut Transaction<'_, Postgres>,
    job_id: Uuid,
    worker_id: &WorkerId,
) -> Result<Option<Uuid>, ArtifactJobsRepositoryError> {
    sqlx::query_scalar(
        r#"
        SELECT domain_id
        FROM jobs
        WHERE id = $1
          AND kind = 'artifact.process'
          AND status = 'running'
          AND locked_by = $2
          AND locked_until > now()
        FOR UPDATE
        "#,
    )
    .bind(job_id)
    .bind(worker_id.as_str())
    .fetch_optional(&mut **transaction)
    .await
    .map_err(ArtifactJobsRepositoryError::unavailable)
}

async fn lock_processing_context(
    transaction: &mut Transaction<'_, Postgres>,
    upload_id: Uuid,
) -> Result<Option<ContextRow>, ArtifactJobsRepositoryError> {
    sqlx::query_as::<_, ContextRow>(
        r#"
        SELECT
            uploads.id AS upload_id,
            uploads.project_id,
            uploads.release_id,
            uploads.staging_key
        FROM uploads
        INNER JOIN releases
            ON releases.id = uploads.release_id
           AND releases.project_id = uploads.project_id
        WHERE uploads.id = $1
          AND uploads.state = 'processing'
          AND releases.state = 'processing'
        FOR UPDATE OF uploads, releases
        "#,
    )
    .bind(upload_id)
    .fetch_optional(&mut **transaction)
    .await
    .map_err(ArtifactJobsRepositoryError::unavailable)
}

async fn fail_processing_domain(
    transaction: &mut Transaction<'_, Postgres>,
    upload_id: Uuid,
    error_code: &str,
    error_detail: &Value,
) -> Result<(), ArtifactJobsRepositoryError> {
    let row = sqlx::query_as::<_, FailureContextRow>(
        r#"
        SELECT
            releases.id AS release_id,
            uploads.project_id,
            projects.organization_id,
            uploads.created_by
        FROM uploads
        INNER JOIN projects ON projects.id = uploads.project_id
        INNER JOIN releases
            ON releases.id = uploads.release_id
           AND releases.project_id = uploads.project_id
        WHERE uploads.id = $1
          AND uploads.state = 'processing'
          AND releases.state = 'processing'
        FOR UPDATE OF uploads, releases
        "#,
    )
    .bind(upload_id)
    .fetch_optional(&mut **transaction)
    .await
    .map_err(ArtifactJobsRepositoryError::unavailable)?;
    let Some(row) = row else {
        return Ok(());
    };
    let upload = sqlx::query(
        r#"
        UPDATE uploads
        SET state = 'failed', error_code = $2, completed_at = now(), updated_at = now()
        WHERE id = $1 AND state = 'processing'
        "#,
    )
    .bind(upload_id)
    .bind(error_code)
    .execute(&mut **transaction)
    .await
    .map_err(ArtifactJobsRepositoryError::unavailable)?;
    let release = sqlx::query(
        r#"
        UPDATE releases
        SET state = 'failed', failure_code = $2, failure_detail = $3
        WHERE id = $1 AND state = 'processing'
        "#,
    )
    .bind(row.release_id)
    .bind(error_code)
    .bind(error_detail)
    .execute(&mut **transaction)
    .await
    .map_err(ArtifactJobsRepositoryError::unavailable)?;
    let audit = sqlx::query(
        r#"
        INSERT INTO audit_logs (
            organization_id, project_id, actor_id, action,
            target_type, target_id, metadata
        )
        VALUES ($1, $2, $3, 'upload.processing_failed', 'upload', $4, $5)
        "#,
    )
    .bind(row.organization_id)
    .bind(row.project_id)
    .bind(row.created_by)
    .bind(upload_id)
    .bind(json!({
        "releaseId": row.release_id,
        "errorCode": error_code,
    }))
    .execute(&mut **transaction)
    .await
    .map_err(ArtifactJobsRepositoryError::unavailable)?;
    if upload.rows_affected() != 1 || release.rows_affected() != 1 || audit.rows_affected() != 1 {
        return Err(ArtifactJobsRepositoryError::InvalidContext);
    }
    Ok(())
}

fn validate_ready_artifact(artifact: &ReadyArtifact) -> Result<(), ArtifactJobsRepositoryError> {
    let digest = artifact.digest.as_str();
    let expected_storage_key = format!(
        "blobs/sha256/{}/{}/{}",
        &digest[0..2],
        &digest[2..4],
        digest
    );
    if artifact.storage_key != expected_storage_key
        || artifact.manifest.version != 1
        || artifact.file_count == 0
        || artifact.manifest.files.len() != artifact.file_count as usize
        || artifact
            .manifest
            .files
            .windows(2)
            .any(|files| files[0].path >= files[1].path)
        || !artifact
            .manifest
            .files
            .iter()
            .any(|entry| entry.path == "index.html")
        || artifact.manifest.files.iter().any(|entry| {
            entry.path.is_empty()
                || entry.path.starts_with('/')
                || entry.path.contains('\\')
                || entry
                    .path
                    .split('/')
                    .any(|component| component.is_empty() || matches!(component, "." | ".."))
                || entry.sha256.len() != 64
                || !entry
                    .sha256
                    .bytes()
                    .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        })
        || artifact
            .manifest
            .files
            .iter()
            .try_fold(0_u64, |total, entry| total.checked_add(entry.size))
            != Some(artifact.total_size)
    {
        return Err(ArtifactJobsRepositoryError::ArtifactConflict);
    }
    Ok(())
}

#[derive(Debug, FromRow)]
struct ContextRow {
    upload_id: Uuid,
    project_id: Uuid,
    release_id: Option<Uuid>,
    staging_key: String,
}

impl ContextRow {
    fn try_into_context(
        self,
        job_id: Uuid,
    ) -> Result<ArtifactJobContext, ArtifactJobsRepositoryError> {
        if self.staging_key != format!("uploads/{}/archive.zip", self.upload_id) {
            return Err(ArtifactJobsRepositoryError::InvalidContext);
        }
        Ok(ArtifactJobContext {
            job_id,
            upload_id: self.upload_id,
            project_id: self.project_id,
            release_id: self
                .release_id
                .ok_or(ArtifactJobsRepositoryError::InvalidContext)?,
        })
    }
}

#[derive(Debug, FromRow)]
struct ExistingArtifactRow {
    id: Uuid,
    storage_key: String,
    state: String,
    file_count: i32,
    total_size: i64,
    manifest: Value,
}

#[derive(Debug, FromRow)]
struct FailureJobRow {
    domain_id: Option<Uuid>,
    attempts: i32,
    max_attempts: i32,
}

#[derive(Debug, FromRow)]
struct FailureContextRow {
    release_id: Uuid,
    project_id: Uuid,
    organization_id: Uuid,
    created_by: Uuid,
}
