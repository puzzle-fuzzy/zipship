use async_trait::async_trait;
use serde_json::json;
use sqlx::PgPool;
use time::OffsetDateTime;
use uuid::Uuid;
use zipship_domain::{MemberRole, UploadStatus};
use zipship_uploads::{
    BeginReceiveResult, FinalizeResult, FinalizedUpload, NewUpload, ReceiveLease, UploadRecord,
    UploadsRepository, UploadsRepositoryError,
};

mod row;

use row::{UploadRow, corrupt_record, parse_role};

#[derive(Debug, Clone)]
pub struct PgUploadsRepository {
    pool: PgPool,
}

impl PgUploadsRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl UploadsRepository for PgUploadsRepository {
    async fn project_role(
        &self,
        project_id: Uuid,
        actor_id: Uuid,
    ) -> Result<Option<MemberRole>, UploadsRepositoryError> {
        let role = sqlx::query_scalar::<_, String>(
            r#"
            SELECT memberships.role
            FROM projects
            INNER JOIN memberships
                ON memberships.organization_id = projects.organization_id
               AND memberships.user_id = $2
            WHERE projects.id = $1 AND projects.deleted_at IS NULL
            "#,
        )
        .bind(project_id)
        .bind(actor_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(UploadsRepositoryError::unavailable)?;
        role.map(|role| parse_role(&role)).transpose()
    }

    async fn create_upload(
        &self,
        upload: NewUpload,
    ) -> Result<UploadRecord, UploadsRepositoryError> {
        let expected_size = i64::try_from(upload.expected_size.bytes())
            .map_err(|_| UploadsRepositoryError::SizeMismatch)?;
        let row = sqlx::query_as::<_, UploadRow>(
            r#"
            INSERT INTO uploads (
                id,
                project_id,
                original_filename,
                expected_size,
                staging_key,
                created_by,
                created_at,
                updated_at,
                expires_at
            )
            SELECT $1, $2, $3, $4, $5, $6, $7, $7, $8
            WHERE EXISTS (
                SELECT 1
                FROM projects
                INNER JOIN memberships
                    ON memberships.organization_id = projects.organization_id
                   AND memberships.user_id = $6
                WHERE projects.id = $2
                  AND projects.deleted_at IS NULL
                  AND memberships.role IN ('owner', 'admin', 'developer')
            )
            RETURNING
                id, project_id, release_id, original_filename, state,
                expected_size, received_size, staging_key, created_by,
                created_at, uploaded_at, completed_at, expires_at, error_code
            "#,
        )
        .bind(upload.id)
        .bind(upload.project_id)
        .bind(upload.original_filename.as_str())
        .bind(expected_size)
        .bind(&upload.staging_key)
        .bind(upload.created_by)
        .bind(upload.created_at)
        .bind(upload.expires_at)
        .fetch_optional(&self.pool)
        .await
        .map_err(UploadsRepositoryError::unavailable)?
        .ok_or(UploadsRepositoryError::Forbidden)?;
        row.try_into()
    }

    async fn begin_receive(
        &self,
        upload_id: Uuid,
        actor_id: Uuid,
        transfer_id: Uuid,
        now: OffsetDateTime,
        lease_expires_at: OffsetDateTime,
    ) -> Result<BeginReceiveResult, UploadsRepositoryError> {
        let row = sqlx::query_as::<_, UploadRow>(
            r#"
            UPDATE uploads
            SET state = 'receiving',
                received_size = 0,
                transfer_id = $3,
                receive_lease_expires_at = $5,
                started_at = COALESCE(started_at, $4),
                error_code = NULL,
                updated_at = $4
            WHERE uploads.id = $1
              AND uploads.expires_at > $4
              AND (
                  uploads.state = 'pending'
                  OR (
                      uploads.state = 'receiving'
                      AND uploads.receive_lease_expires_at <= $4
                  )
              )
              AND EXISTS (
                  SELECT 1
                  FROM projects
                  INNER JOIN memberships
                      ON memberships.organization_id = projects.organization_id
                     AND memberships.user_id = $2
                  WHERE projects.id = uploads.project_id
                    AND projects.deleted_at IS NULL
                    AND memberships.role IN ('owner', 'admin', 'developer')
              )
            RETURNING
                id, project_id, release_id, original_filename, state,
                expected_size, received_size, staging_key, created_by,
                created_at, uploaded_at, completed_at, expires_at, error_code
            "#,
        )
        .bind(upload_id)
        .bind(actor_id)
        .bind(transfer_id)
        .bind(now)
        .bind(lease_expires_at)
        .fetch_optional(&self.pool)
        .await
        .map_err(UploadsRepositoryError::unavailable)?;

        if let Some(row) = row {
            return Ok(BeginReceiveResult::Started(ReceiveLease {
                upload: row.try_into()?,
                transfer_id,
            }));
        }
        let current = self
            .find_upload_with_upload_permission(upload_id, actor_id)
            .await?
            .ok_or(UploadsRepositoryError::NotFound)?;
        if matches!(
            current.status,
            UploadStatus::Uploaded | UploadStatus::Processing | UploadStatus::Completed
        ) {
            return Ok(BeginReceiveResult::AlreadyUploaded(current));
        }
        if current.expires_at <= now {
            return Err(UploadsRepositoryError::Expired);
        }
        Err(UploadsRepositoryError::StateConflict)
    }

    async fn mark_uploaded(
        &self,
        upload_id: Uuid,
        actor_id: Uuid,
        transfer_id: Uuid,
        received_size: u64,
        now: OffsetDateTime,
    ) -> Result<UploadRecord, UploadsRepositoryError> {
        let received_size =
            i64::try_from(received_size).map_err(|_| UploadsRepositoryError::SizeMismatch)?;
        let row = sqlx::query_as::<_, UploadRow>(
            r#"
            UPDATE uploads
            SET state = 'uploaded',
                received_size = $4,
                uploaded_at = $5,
                transfer_id = NULL,
                receive_lease_expires_at = NULL,
                error_code = NULL,
                updated_at = $5
            WHERE uploads.id = $1
              AND uploads.state = 'receiving'
              AND uploads.transfer_id = $3
              AND uploads.expected_size = $4
              AND EXISTS (
                  SELECT 1
                  FROM projects
                  INNER JOIN memberships
                      ON memberships.organization_id = projects.organization_id
                     AND memberships.user_id = $2
                  WHERE projects.id = uploads.project_id
                    AND projects.deleted_at IS NULL
                    AND memberships.role IN ('owner', 'admin', 'developer')
              )
            RETURNING
                id, project_id, release_id, original_filename, state,
                expected_size, received_size, staging_key, created_by,
                created_at, uploaded_at, completed_at, expires_at, error_code
            "#,
        )
        .bind(upload_id)
        .bind(actor_id)
        .bind(transfer_id)
        .bind(received_size)
        .bind(now)
        .fetch_optional(&self.pool)
        .await
        .map_err(UploadsRepositoryError::unavailable)?;
        if let Some(row) = row {
            return row.try_into();
        }
        let current = self
            .find_upload_with_upload_permission(upload_id, actor_id)
            .await?
            .ok_or(UploadsRepositoryError::NotFound)?;
        if i64::try_from(current.expected_size).ok() != Some(received_size) {
            return Err(UploadsRepositoryError::SizeMismatch);
        }
        Err(UploadsRepositoryError::StateConflict)
    }

    async fn requeue_receive(
        &self,
        upload_id: Uuid,
        actor_id: Uuid,
        transfer_id: Uuid,
        error_code: &'static str,
        now: OffsetDateTime,
    ) -> Result<(), UploadsRepositoryError> {
        let result = sqlx::query(
            r#"
            UPDATE uploads
            SET state = 'pending',
                received_size = 0,
                transfer_id = NULL,
                receive_lease_expires_at = NULL,
                error_code = $4,
                updated_at = $5
            WHERE uploads.id = $1
              AND uploads.state = 'receiving'
              AND uploads.transfer_id = $3
              AND EXISTS (
                  SELECT 1
                  FROM projects
                  INNER JOIN memberships
                      ON memberships.organization_id = projects.organization_id
                     AND memberships.user_id = $2
                  WHERE projects.id = uploads.project_id
                    AND projects.deleted_at IS NULL
                    AND memberships.role IN ('owner', 'admin', 'developer')
              )
            "#,
        )
        .bind(upload_id)
        .bind(actor_id)
        .bind(transfer_id)
        .bind(error_code)
        .bind(now)
        .execute(&self.pool)
        .await
        .map_err(UploadsRepositoryError::unavailable)?;
        if result.rows_affected() == 1 {
            Ok(())
        } else {
            Err(UploadsRepositoryError::StateConflict)
        }
    }

    async fn finalize_upload(
        &self,
        upload_id: Uuid,
        actor_id: Uuid,
        now: OffsetDateTime,
    ) -> Result<FinalizeResult, UploadsRepositoryError> {
        let mut transaction = self
            .pool
            .begin()
            .await
            .map_err(UploadsRepositoryError::unavailable)?;
        let row = sqlx::query_as::<_, UploadRow>(
            r#"
            SELECT
                uploads.id, uploads.project_id, uploads.release_id,
                uploads.original_filename, uploads.state, uploads.expected_size,
                uploads.received_size, uploads.staging_key, uploads.created_by,
                uploads.created_at, uploads.uploaded_at, uploads.completed_at,
                uploads.expires_at, uploads.error_code
            FROM uploads
            INNER JOIN projects ON projects.id = uploads.project_id
            INNER JOIN memberships
                ON memberships.organization_id = projects.organization_id
               AND memberships.user_id = $2
            WHERE uploads.id = $1
              AND projects.deleted_at IS NULL
              AND memberships.role IN ('owner', 'admin', 'developer')
            FOR UPDATE OF uploads
            "#,
        )
        .bind(upload_id)
        .bind(actor_id)
        .fetch_optional(&mut *transaction)
        .await
        .map_err(UploadsRepositoryError::unavailable)?
        .ok_or(UploadsRepositoryError::NotFound)?;
        let current: UploadRecord = row.try_into()?;

        if matches!(
            current.status,
            UploadStatus::Processing | UploadStatus::Completed
        ) {
            let finalized = existing_finalization(&mut transaction, current).await?;
            transaction
                .commit()
                .await
                .map_err(UploadsRepositoryError::unavailable)?;
            return Ok(FinalizeResult::Existing(finalized));
        }
        if current.status != UploadStatus::Uploaded {
            return Err(UploadsRepositoryError::StateConflict);
        }
        if current.expires_at <= now {
            return Err(UploadsRepositoryError::Expired);
        }

        sqlx::query("SELECT id FROM projects WHERE id = $1 FOR UPDATE")
            .bind(current.project_id)
            .fetch_one(&mut *transaction)
            .await
            .map_err(UploadsRepositoryError::unavailable)?;
        let version_number: i32 = sqlx::query_scalar(
            r#"
            SELECT COALESCE(MAX(version_number), 0) + 1
            FROM releases
            WHERE project_id = $1
            "#,
        )
        .bind(current.project_id)
        .fetch_one(&mut *transaction)
        .await
        .map_err(UploadsRepositoryError::unavailable)?;

        let release_id = Uuid::new_v4();
        let job_id = Uuid::new_v4();
        sqlx::query(
            r#"
            INSERT INTO releases (
                id, project_id, version_number, state, created_by, created_at
            )
            VALUES ($1, $2, $3, 'processing', $4, $5)
            "#,
        )
        .bind(release_id)
        .bind(current.project_id)
        .bind(version_number)
        .bind(actor_id)
        .bind(now)
        .execute(&mut *transaction)
        .await
        .map_err(UploadsRepositoryError::unavailable)?;

        let updated_row = sqlx::query_as::<_, UploadRow>(
            r#"
            UPDATE uploads
            SET state = 'processing', release_id = $2, error_code = NULL, updated_at = $3
            WHERE id = $1 AND state = 'uploaded'
            RETURNING
                id, project_id, release_id, original_filename, state,
                expected_size, received_size, staging_key, created_by,
                created_at, uploaded_at, completed_at, expires_at, error_code
            "#,
        )
        .bind(upload_id)
        .bind(release_id)
        .bind(now)
        .fetch_one(&mut *transaction)
        .await
        .map_err(UploadsRepositoryError::unavailable)?;
        let updated: UploadRecord = updated_row.try_into()?;

        let dedupe_key = format!("upload:{upload_id}");
        let job_input = json!({
            "uploadId": upload_id,
            "projectId": current.project_id,
            "releaseId": release_id,
            "stagingKey": current.staging_key,
        });
        sqlx::query(
            r#"
            INSERT INTO jobs (
                id, kind, domain_id, dedupe_key, priority, max_attempts,
                next_run_at, input_json, created_at
            )
            VALUES ($1, 'artifact.process', $2, $3, 10, 5, $4, $5, $4)
            "#,
        )
        .bind(job_id)
        .bind(upload_id)
        .bind(&dedupe_key)
        .bind(now)
        .bind(&job_input)
        .execute(&mut *transaction)
        .await
        .map_err(UploadsRepositoryError::unavailable)?;

        sqlx::query(
            r#"
            INSERT INTO audit_logs (
                organization_id, project_id, actor_id, action,
                target_type, target_id, metadata, created_at
            )
            SELECT
                projects.organization_id,
                projects.id,
                $2,
                'upload.processing_queued',
                'upload',
                $1,
                $3,
                $4
            FROM projects
            WHERE projects.id = $5
            "#,
        )
        .bind(upload_id)
        .bind(actor_id)
        .bind(json!({ "releaseId": release_id, "jobId": job_id }))
        .bind(now)
        .bind(current.project_id)
        .execute(&mut *transaction)
        .await
        .map_err(UploadsRepositoryError::unavailable)?;

        transaction
            .commit()
            .await
            .map_err(UploadsRepositoryError::unavailable)?;
        Ok(FinalizeResult::Created(FinalizedUpload {
            upload: updated,
            release_id,
            job_id,
        }))
    }

    async fn find_upload_for_member(
        &self,
        upload_id: Uuid,
        actor_id: Uuid,
    ) -> Result<Option<UploadRecord>, UploadsRepositoryError> {
        let row = sqlx::query_as::<_, UploadRow>(
            r#"
            SELECT
                uploads.id, uploads.project_id, uploads.release_id,
                uploads.original_filename, uploads.state, uploads.expected_size,
                uploads.received_size, uploads.staging_key, uploads.created_by,
                uploads.created_at, uploads.uploaded_at, uploads.completed_at,
                uploads.expires_at, uploads.error_code
            FROM uploads
            INNER JOIN projects ON projects.id = uploads.project_id
            INNER JOIN memberships
                ON memberships.organization_id = projects.organization_id
               AND memberships.user_id = $2
            WHERE uploads.id = $1 AND projects.deleted_at IS NULL
            "#,
        )
        .bind(upload_id)
        .bind(actor_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(UploadsRepositoryError::unavailable)?;
        row.map(TryInto::try_into).transpose()
    }
}

impl PgUploadsRepository {
    async fn find_upload_with_upload_permission(
        &self,
        upload_id: Uuid,
        actor_id: Uuid,
    ) -> Result<Option<UploadRecord>, UploadsRepositoryError> {
        let row = sqlx::query_as::<_, UploadRow>(
            r#"
            SELECT
                uploads.id, uploads.project_id, uploads.release_id,
                uploads.original_filename, uploads.state, uploads.expected_size,
                uploads.received_size, uploads.staging_key, uploads.created_by,
                uploads.created_at, uploads.uploaded_at, uploads.completed_at,
                uploads.expires_at, uploads.error_code
            FROM uploads
            INNER JOIN projects ON projects.id = uploads.project_id
            INNER JOIN memberships
                ON memberships.organization_id = projects.organization_id
               AND memberships.user_id = $2
            WHERE uploads.id = $1
              AND projects.deleted_at IS NULL
              AND memberships.role IN ('owner', 'admin', 'developer')
            "#,
        )
        .bind(upload_id)
        .bind(actor_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(UploadsRepositoryError::unavailable)?;
        row.map(TryInto::try_into).transpose()
    }
}

async fn existing_finalization(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    upload: UploadRecord,
) -> Result<FinalizedUpload, UploadsRepositoryError> {
    let release_id = upload
        .release_id
        .ok_or_else(|| corrupt_record("uploads.release_id"))?;
    let job_id = sqlx::query_scalar::<_, Uuid>(
        r#"
        SELECT id
        FROM jobs
        WHERE kind = 'artifact.process' AND domain_id = $1
        ORDER BY created_at ASC
        LIMIT 1
        "#,
    )
    .bind(upload.id)
    .fetch_optional(&mut **transaction)
    .await
    .map_err(UploadsRepositoryError::unavailable)?
    .ok_or_else(|| corrupt_record("jobs.domain_id"))?;
    Ok(FinalizedUpload {
        upload,
        release_id,
        job_id,
    })
}

#[cfg(test)]
mod tests;
