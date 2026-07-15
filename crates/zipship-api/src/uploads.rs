use super::AppState;
use crate::{
    error::{ApiError, ErrorResponse},
    request::{authenticate, format_timestamp, no_store, parse_uuid, require_csrf},
};
use axum::{
    Json, Router,
    body::Body,
    extract::{Path, State, rejection::JsonRejection},
    http::{HeaderMap, StatusCode, header},
    response::IntoResponse,
    routing::{get, post, put},
};
use axum_extra::extract::CookieJar;
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::io;
use tokio_util::io::StreamReader;
use tracing::warn;
use utoipa::ToSchema;
use uuid::Uuid;
use zipship_storage::StorageError;
use zipship_uploads::{
    BeginReceiveResult, CreateUploadCommand, FinalizeResult, ReceiveLease, UploadRecord,
    UploadsError,
};

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CreateUploadRequest {
    filename: String,
    size_bytes: u64,
}

#[derive(Debug, Serialize, ToSchema)]
pub(crate) struct UploadEnvelope {
    upload: UploadResponse,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UploadResponse {
    id: Uuid,
    project_id: Uuid,
    release_id: Option<Uuid>,
    filename: String,
    status: String,
    expected_size: u64,
    received_size: u64,
    created_by: Uuid,
    created_at: String,
    uploaded_at: Option<String>,
    completed_at: Option<String>,
    expires_at: String,
    error_code: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FinalizeUploadResponse {
    upload: UploadResponse,
    release_id: Uuid,
    job_id: Uuid,
}

pub(crate) fn standard_router() -> Router<AppState> {
    Router::new()
        .route("/_api/projects/{project_id}/uploads", post(create_upload))
        .route("/_api/uploads/{upload_id}", get(get_upload))
        .route("/_api/uploads/{upload_id}/complete", post(finalize_upload))
}

pub(crate) fn content_router() -> Router<AppState> {
    Router::new().route("/_api/uploads/{upload_id}/content", put(upload_content))
}

#[utoipa::path(
    post,
    path = "/_api/projects/{project_id}/uploads",
    tag = "uploads",
    params(
        ("project_id" = Uuid, Path, description = "Project ID"),
        ("x-csrf-token" = String, Header, description = "CSRF token issued with the session")
    ),
    request_body = CreateUploadRequest,
    responses(
        (status = 201, description = "Upload reservation created", body = UploadEnvelope),
        (status = 401, description = "Session is absent or invalid", body = ErrorResponse),
        (status = 403, description = "Current role cannot upload releases", body = ErrorResponse),
        (status = 422, description = "Filename or size is invalid", body = ErrorResponse),
        (status = 503, description = "Upload storage is unavailable", body = ErrorResponse)
    )
)]
pub(crate) async fn create_upload(
    State(state): State<AppState>,
    jar: CookieJar,
    headers: HeaderMap,
    Path(project_id): Path<String>,
    payload: Result<Json<CreateUploadRequest>, JsonRejection>,
) -> Result<impl IntoResponse, ApiError> {
    let session = authenticate(&state, &jar).await?;
    require_csrf(&state, &session, &headers)?;
    let project_id = parse_uuid(&project_id)?;
    let Json(payload) = payload.map_err(|_| ApiError::invalid_json())?;
    let upload = state
        .uploads
        .create(CreateUploadCommand {
            actor_id: session.user.id,
            project_id,
            original_filename: payload.filename,
            expected_size: payload.size_bytes,
        })
        .await?;
    Ok((
        StatusCode::CREATED,
        no_store(Json(UploadEnvelope {
            upload: upload.into(),
        })),
    ))
}

#[utoipa::path(
    put,
    path = "/_api/uploads/{upload_id}/content",
    tag = "uploads",
    params(
        ("upload_id" = Uuid, Path, description = "Upload ID"),
        ("content-length" = u64, Header, description = "Exact byte count reserved for the upload"),
        ("x-csrf-token" = String, Header, description = "CSRF token issued with the session")
    ),
    request_body(content = Vec<u8>, content_type = "application/zip"),
    responses(
        (status = 200, description = "Archive streamed into durable staging", body = UploadEnvelope),
        (status = 411, description = "Content-Length is required", body = ErrorResponse),
        (status = 413, description = "Body exceeds the configured maximum", body = ErrorResponse),
        (status = 415, description = "Content type is not a raw ZIP archive", body = ErrorResponse),
        (status = 422, description = "Body length differs from the reservation", body = ErrorResponse),
        (status = 503, description = "Upload storage is unavailable", body = ErrorResponse)
    )
)]
pub(crate) async fn upload_content(
    State(state): State<AppState>,
    jar: CookieJar,
    headers: HeaderMap,
    Path(upload_id): Path<String>,
    body: Body,
) -> Result<impl IntoResponse, ApiError> {
    let session = authenticate(&state, &jar).await?;
    require_csrf(&state, &session, &headers)?;
    let upload_id = parse_uuid(&upload_id)?;
    let declared_size = declared_body_size(&headers, state.uploads.maximum_bytes())?;
    require_zip_content_type(&headers)?;

    let lease = match state
        .uploads
        .begin_receive(upload_id, session.user.id)
        .await?
    {
        BeginReceiveResult::AlreadyUploaded(upload) => {
            return Ok(no_store(Json(UploadEnvelope {
                upload: upload.into(),
            })));
        }
        BeginReceiveResult::Started(lease) => lease,
    };
    if declared_size != lease.upload.expected_size {
        best_effort_requeue(&state, &lease, session.user.id, "DECLARED_SIZE_MISMATCH").await;
        return Err(ApiError::new(
            StatusCode::UNPROCESSABLE_ENTITY,
            "UPLOAD_SIZE_MISMATCH",
        ));
    }

    let stream = body
        .into_data_stream()
        .map(|chunk| chunk.map_err(io::Error::other));
    let reader = StreamReader::new(stream);
    let write = state
        .storage
        .write_upload_stream(
            upload_id,
            lease.transfer_id,
            reader,
            lease.upload.expected_size,
        )
        .await;
    let write = match write {
        Ok(write) => write,
        Err(error) => {
            best_effort_requeue(&state, &lease, session.user.id, "UPLOAD_STREAM_FAILED").await;
            return Err(storage_error(error));
        }
    };
    let upload = match state
        .uploads
        .mark_uploaded(&lease, session.user.id, write.bytes_written)
        .await
    {
        Ok(upload) => upload,
        Err(error) => {
            best_effort_requeue(&state, &lease, session.user.id, "UPLOAD_CONFIRM_FAILED").await;
            return Err(error.into());
        }
    };
    Ok(no_store(Json(UploadEnvelope {
        upload: upload.into(),
    })))
}

#[utoipa::path(
    post,
    path = "/_api/uploads/{upload_id}/complete",
    tag = "uploads",
    params(
        ("upload_id" = Uuid, Path, description = "Upload ID"),
        ("x-csrf-token" = String, Header, description = "CSRF token issued with the session")
    ),
    responses(
        (status = 202, description = "Artifact processing is queued idempotently", body = FinalizeUploadResponse),
        (status = 409, description = "The upload has not been received", body = ErrorResponse),
        (status = 410, description = "The upload reservation expired", body = ErrorResponse),
        (status = 503, description = "Upload storage is unavailable", body = ErrorResponse)
    )
)]
pub(crate) async fn finalize_upload(
    State(state): State<AppState>,
    jar: CookieJar,
    headers: HeaderMap,
    Path(upload_id): Path<String>,
) -> Result<impl IntoResponse, ApiError> {
    let session = authenticate(&state, &jar).await?;
    require_csrf(&state, &session, &headers)?;
    let upload_id = parse_uuid(&upload_id)?;
    let finalized = match state.uploads.finalize(upload_id, session.user.id).await? {
        FinalizeResult::Created(finalized) | FinalizeResult::Existing(finalized) => finalized,
    };
    Ok((
        StatusCode::ACCEPTED,
        no_store(Json(FinalizeUploadResponse {
            upload: finalized.upload.into(),
            release_id: finalized.release_id,
            job_id: finalized.job_id,
        })),
    ))
}

#[utoipa::path(
    get,
    path = "/_api/uploads/{upload_id}",
    tag = "uploads",
    params(("upload_id" = Uuid, Path, description = "Upload ID")),
    responses(
        (status = 200, description = "Upload visible to the current member", body = UploadEnvelope),
        (status = 404, description = "Upload is missing or not visible", body = ErrorResponse),
        (status = 503, description = "Upload storage is unavailable", body = ErrorResponse)
    )
)]
pub(crate) async fn get_upload(
    State(state): State<AppState>,
    jar: CookieJar,
    Path(upload_id): Path<String>,
) -> Result<impl IntoResponse, ApiError> {
    let session = authenticate(&state, &jar).await?;
    let upload_id = parse_uuid(&upload_id)?;
    let upload = state.uploads.get(upload_id, session.user.id).await?;
    Ok(no_store(Json(UploadEnvelope {
        upload: upload.into(),
    })))
}

fn declared_body_size(headers: &HeaderMap, maximum_bytes: u64) -> Result<u64, ApiError> {
    let value = headers
        .get(header::CONTENT_LENGTH)
        .ok_or_else(|| ApiError::new(StatusCode::LENGTH_REQUIRED, "CONTENT_LENGTH_REQUIRED"))?;
    let value = value
        .to_str()
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .filter(|value| *value > 0)
        .ok_or_else(|| ApiError::new(StatusCode::BAD_REQUEST, "INVALID_CONTENT_LENGTH"))?;
    if value > maximum_bytes {
        return Err(ApiError::new(
            StatusCode::PAYLOAD_TOO_LARGE,
            "UPLOAD_TOO_LARGE",
        ));
    }
    Ok(value)
}

fn require_zip_content_type(headers: &HeaderMap) -> Result<(), ApiError> {
    let media_type = headers
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(';').next())
        .map(str::trim);
    if media_type.is_some_and(|value| {
        value.eq_ignore_ascii_case("application/zip")
            || value.eq_ignore_ascii_case("application/octet-stream")
            || value.eq_ignore_ascii_case("application/x-zip-compressed")
    }) {
        Ok(())
    } else {
        Err(ApiError::new(
            StatusCode::UNSUPPORTED_MEDIA_TYPE,
            "UNSUPPORTED_UPLOAD_CONTENT_TYPE",
        ))
    }
}

async fn best_effort_requeue(
    state: &AppState,
    lease: &ReceiveLease,
    actor_id: Uuid,
    error_code: &'static str,
) {
    if let Err(error) = state
        .uploads
        .requeue_interrupted_receive(lease, actor_id, error_code)
        .await
    {
        warn!(
            upload_id = %lease.upload.id,
            transfer_id = %lease.transfer_id,
            error = %error,
            "failed to requeue an interrupted upload"
        );
    }
}

fn storage_error(error: StorageError) -> ApiError {
    match error {
        StorageError::UploadTooLarge { .. } | StorageError::UploadSizeMismatch { .. } => {
            ApiError::new(StatusCode::UNPROCESSABLE_ENTITY, "UPLOAD_SIZE_MISMATCH")
        }
        StorageError::Io(_)
        | StorageError::InvalidStagingPath
        | StorageError::InvalidStagingDirectory
        | StorageError::InvalidArtifactPath
        | StorageError::InvalidArtifactDirectory
        | StorageError::InvalidArtifactFile => {
            ApiError::new(StatusCode::SERVICE_UNAVAILABLE, "UPLOAD_STORAGE_FAILURE")
        }
    }
}

impl From<UploadsError> for ApiError {
    fn from(error: UploadsError) -> Self {
        let status = match error {
            UploadsError::InvalidInput | UploadsError::SizeMismatch => {
                StatusCode::UNPROCESSABLE_ENTITY
            }
            UploadsError::Forbidden => StatusCode::FORBIDDEN,
            UploadsError::NotFound => StatusCode::NOT_FOUND,
            UploadsError::StateConflict => StatusCode::CONFLICT,
            UploadsError::Expired => StatusCode::GONE,
            UploadsError::Infrastructure => StatusCode::SERVICE_UNAVAILABLE,
        };
        Self::new(status, error.code())
    }
}

impl From<UploadRecord> for UploadResponse {
    fn from(upload: UploadRecord) -> Self {
        Self {
            id: upload.id,
            project_id: upload.project_id,
            release_id: upload.release_id,
            filename: upload.original_filename,
            status: upload.status.as_str().to_owned(),
            expected_size: upload.expected_size,
            received_size: upload.received_size,
            created_by: upload.created_by,
            created_at: format_timestamp(upload.created_at),
            uploaded_at: upload.uploaded_at.map(format_timestamp),
            completed_at: upload.completed_at.map(format_timestamp),
            expires_at: format_timestamp(upload.expires_at),
            error_code: upload.error_code,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_stream_headers_without_allocating_the_body() {
        let mut headers = HeaderMap::new();
        assert!(declared_body_size(&headers, 100).is_err());
        headers.insert(header::CONTENT_LENGTH, "101".parse().unwrap());
        assert!(declared_body_size(&headers, 100).is_err());
        headers.insert(header::CONTENT_LENGTH, "100".parse().unwrap());
        headers.insert(header::CONTENT_TYPE, "application/zip".parse().unwrap());
        assert_eq!(declared_body_size(&headers, 100).unwrap(), 100);
        assert!(require_zip_content_type(&headers).is_ok());
    }
}
