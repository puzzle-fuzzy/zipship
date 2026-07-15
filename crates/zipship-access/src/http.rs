use std::{io::SeekFrom, sync::Arc};

use axum::{
    Router,
    body::Body,
    extract::{Path, State, rejection::PathRejection},
    http::{HeaderMap, HeaderName, HeaderValue, Method, Response, StatusCode, header},
    routing::get,
};
use tokio::io::{AsyncReadExt, AsyncSeekExt};
use tokio_util::io::ReaderStream;
use tower_http::{
    catch_panic::CatchPanicLayer,
    request_id::{MakeRequestUuid, PropagateRequestIdLayer, SetRequestIdLayer},
    set_header::SetResponseHeaderLayer,
    trace::TraceLayer,
};
use tracing::error;
use uuid::Uuid;
use zipship_domain::ProjectSlug;
use zipship_storage::LocalArtifactStore;

use crate::{
    PreviewRelease, PreviewRepository,
    http_policy::{
        RangeSelection, accepts_html, cache_control, content_type, error_response, if_none_match,
        insert_header, metadata_only_response, range_not_satisfiable_response, requested_range,
    },
};

#[derive(Clone)]
pub struct PreviewService {
    repository: Arc<dyn PreviewRepository>,
    storage: LocalArtifactStore,
}

impl PreviewService {
    pub fn new(repository: Arc<dyn PreviewRepository>, storage: LocalArtifactStore) -> Self {
        Self {
            repository,
            storage,
        }
    }

    async fn serve(
        &self,
        method: &Method,
        headers: &HeaderMap,
        project_slug: &str,
        release_id: &str,
        request_path: &str,
    ) -> Response<Body> {
        let Ok(project_slug) = ProjectSlug::parse(project_slug) else {
            return error_response(StatusCode::NOT_FOUND);
        };
        let Ok(release_id) = Uuid::parse_str(release_id) else {
            return error_response(StatusCode::NOT_FOUND);
        };
        let release = match self
            .repository
            .find_ready_release(&project_slug, release_id)
            .await
        {
            Ok(Some(release)) => release,
            Ok(None) => return error_response(StatusCode::NOT_FOUND),
            Err(repository_error) => {
                error!(error = %repository_error, %release_id, "preview repository lookup failed");
                return error_response(StatusCode::SERVICE_UNAVAILABLE);
            }
        };
        self.serve_release(method, headers, release, request_path)
            .await
    }

    async fn serve_active(
        &self,
        method: &Method,
        headers: &HeaderMap,
        project_slug: &str,
        request_path: &str,
    ) -> Response<Body> {
        let Ok(project_slug) = ProjectSlug::parse(project_slug) else {
            return error_response(StatusCode::NOT_FOUND);
        };
        let release = match self.repository.find_active_release(&project_slug).await {
            Ok(Some(release)) => release,
            Ok(None) => return error_response(StatusCode::NOT_FOUND),
            Err(repository_error) => {
                error!(
                    error = %repository_error,
                    project_slug = %project_slug.as_str(),
                    "active release repository lookup failed"
                );
                return error_response(StatusCode::SERVICE_UNAVAILABLE);
            }
        };
        self.serve_release(method, headers, release, request_path)
            .await
    }

    async fn serve_release(
        &self,
        method: &Method,
        headers: &HeaderMap,
        release: PreviewRelease,
        request_path: &str,
    ) -> Response<Body> {
        let release_id = release.release_id();
        let asset = match release.resolve_asset(request_path, accepts_html(headers)) {
            Ok(Some(asset)) => asset,
            Ok(None) | Err(_) => return error_response(StatusCode::NOT_FOUND),
        };
        let etag = format!("\"{}\"", asset.sha256);
        let cache_control = cache_control(asset.path.as_str(), release.cache_policy());
        if if_none_match(headers, &etag) {
            return metadata_only_response(
                StatusCode::NOT_MODIFIED,
                &etag,
                cache_control,
                asset.spa_fallback,
            );
        }

        let mut file = match self
            .storage
            .open_artifact_file(release.artifact_digest(), &asset.path)
            .await
        {
            Ok(file) => file,
            Err(storage_error) => {
                error!(
                    error = %storage_error,
                    %release_id,
                    asset_path = %asset.path,
                    "ready preview artifact is unavailable"
                );
                return error_response(StatusCode::SERVICE_UNAVAILABLE);
            }
        };
        let size = match file.metadata().await {
            Ok(metadata) if metadata.len() == asset.size => metadata.len(),
            Ok(metadata) => {
                error!(
                    %release_id,
                    asset_path = %asset.path,
                    manifest_size = asset.size,
                    stored_size = metadata.len(),
                    "preview artifact size disagrees with manifest"
                );
                return error_response(StatusCode::SERVICE_UNAVAILABLE);
            }
            Err(io_error) => {
                error!(error = %io_error, %release_id, "preview artifact metadata failed");
                return error_response(StatusCode::SERVICE_UNAVAILABLE);
            }
        };
        let range = requested_range(method, headers, &etag, size);
        let (status, start, length, content_range) = match range {
            RangeSelection::Full => (StatusCode::OK, 0, size, None),
            RangeSelection::Partial { start, end } => (
                StatusCode::PARTIAL_CONTENT,
                start,
                end - start + 1,
                Some(format!("bytes {start}-{end}/{size}")),
            ),
            RangeSelection::Unsatisfiable => {
                return range_not_satisfiable_response(
                    size,
                    &etag,
                    cache_control,
                    asset.spa_fallback,
                );
            }
        };

        if start > 0 && file.seek(SeekFrom::Start(start)).await.is_err() {
            return error_response(StatusCode::SERVICE_UNAVAILABLE);
        }
        let body = if method == Method::HEAD || length == 0 {
            Body::empty()
        } else {
            Body::from_stream(ReaderStream::new(file.take(length)))
        };
        let mut response = Response::new(body);
        *response.status_mut() = status;
        let response_headers = response.headers_mut();
        insert_header(response_headers, header::CONTENT_LENGTH, length.to_string());
        insert_header(
            response_headers,
            header::CONTENT_TYPE,
            content_type(&asset.path),
        );
        insert_header(response_headers, header::ETAG, etag);
        insert_header(response_headers, header::CACHE_CONTROL, cache_control);
        response_headers.insert(header::ACCEPT_RANGES, HeaderValue::from_static("bytes"));
        if let Some(content_range) = content_range {
            insert_header(response_headers, header::CONTENT_RANGE, content_range);
        }
        if asset.spa_fallback {
            response_headers.insert(header::VARY, HeaderValue::from_static("Accept"));
        }
        response
    }
}

pub fn build_router(service: PreviewService) -> Router {
    let request_id_header = HeaderName::from_static("x-request-id");
    Router::new()
        .route("/_sites/{project_slug}/{release_id}", get(preview_root))
        .route("/_sites/{project_slug}/{release_id}/", get(preview_root))
        .route(
            "/_sites/{project_slug}/{release_id}/{*path}",
            get(preview_asset),
        )
        .route("/{project_slug}", get(active_root))
        .route("/{project_slug}/", get(active_root))
        .route("/{project_slug}/{*path}", get(active_asset))
        .with_state(service)
        .layer(SetResponseHeaderLayer::if_not_present(
            HeaderName::from_static("referrer-policy"),
            HeaderValue::from_static("no-referrer"),
        ))
        .layer(SetResponseHeaderLayer::if_not_present(
            header::X_CONTENT_TYPE_OPTIONS,
            HeaderValue::from_static("nosniff"),
        ))
        .layer(CatchPanicLayer::new())
        .layer(TraceLayer::new_for_http())
        .layer(PropagateRequestIdLayer::new(request_id_header.clone()))
        .layer(SetRequestIdLayer::new(request_id_header, MakeRequestUuid))
}

async fn preview_root(
    State(service): State<PreviewService>,
    method: Method,
    headers: HeaderMap,
    params: Result<Path<(String, String)>, PathRejection>,
) -> Response<Body> {
    let Ok(Path((project_slug, release_id))) = params else {
        return error_response(StatusCode::NOT_FOUND);
    };
    service
        .serve(&method, &headers, &project_slug, &release_id, "")
        .await
}

async fn preview_asset(
    State(service): State<PreviewService>,
    method: Method,
    headers: HeaderMap,
    params: Result<Path<(String, String, String)>, PathRejection>,
) -> Response<Body> {
    let Ok(Path((project_slug, release_id, path))) = params else {
        return error_response(StatusCode::NOT_FOUND);
    };
    service
        .serve(&method, &headers, &project_slug, &release_id, &path)
        .await
}

async fn active_root(
    State(service): State<PreviewService>,
    method: Method,
    headers: HeaderMap,
    params: Result<Path<String>, PathRejection>,
) -> Response<Body> {
    let Ok(Path(project_slug)) = params else {
        return error_response(StatusCode::NOT_FOUND);
    };
    service
        .serve_active(&method, &headers, &project_slug, "")
        .await
}

async fn active_asset(
    State(service): State<PreviewService>,
    method: Method,
    headers: HeaderMap,
    params: Result<Path<(String, String)>, PathRejection>,
) -> Response<Body> {
    let Ok(Path((project_slug, path))) = params else {
        return error_response(StatusCode::NOT_FOUND);
    };
    service
        .serve_active(&method, &headers, &project_slug, &path)
        .await
}
