#![forbid(unsafe_code)]

use async_trait::async_trait;
use axum::{
    Router,
    body::Body,
    extract::{Path, State, rejection::PathRejection},
    http::{HeaderMap, HeaderName, HeaderValue, Method, Response, StatusCode, header},
    routing::get,
};
use std::{collections::BTreeMap, error::Error as StdError, io::SeekFrom, sync::Arc};
use thiserror::Error;
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
use zipship_artifact::{ArtifactManifest, ManifestEntry};
use zipship_domain::{ArtifactDigest, CachePolicy, ProjectSlug};
use zipship_storage::LocalArtifactStore;

const MANIFEST_VERSION: u32 = 1;
const MAX_ASSET_PATH_BYTES: usize = 4_096;

#[derive(Debug, Error, Clone, PartialEq, Eq)]
pub enum PreviewReleaseError {
    #[error("preview artifact metadata is inconsistent")]
    InvalidArtifactMetadata,
    #[error("preview artifact manifest is invalid")]
    InvalidManifest,
    #[error("preview artifact has no index.html")]
    MissingIndex,
}

#[derive(Debug, Clone)]
pub struct PreviewRelease {
    release_id: Uuid,
    project_slug: ProjectSlug,
    artifact_digest: ArtifactDigest,
    cache_policy: CachePolicy,
    spa_fallback: bool,
    files: BTreeMap<String, ManifestEntry>,
}

impl PreviewRelease {
    #[allow(clippy::too_many_arguments)]
    pub fn try_new(
        release_id: Uuid,
        project_slug: ProjectSlug,
        artifact_digest: ArtifactDigest,
        storage_key: &str,
        cache_policy: CachePolicy,
        spa_fallback: bool,
        expected_file_count: u32,
        expected_total_size: u64,
        manifest: ArtifactManifest,
    ) -> Result<Self, PreviewReleaseError> {
        if storage_key != expected_storage_key(&artifact_digest)
            || manifest.version != MANIFEST_VERSION
            || manifest.files.len() != expected_file_count as usize
            || manifest
                .files
                .iter()
                .try_fold(0_u64, |total, file| total.checked_add(file.size))
                != Some(expected_total_size)
        {
            return Err(PreviewReleaseError::InvalidArtifactMetadata);
        }

        let mut files = BTreeMap::new();
        for file in manifest.files {
            if !valid_asset_path(&file.path)
                || ArtifactDigest::parse(&file.sha256).is_err()
                || files.insert(file.path.clone(), file).is_some()
            {
                return Err(PreviewReleaseError::InvalidManifest);
            }
        }
        if !files.contains_key("index.html") {
            return Err(PreviewReleaseError::MissingIndex);
        }

        Ok(Self {
            release_id,
            project_slug,
            artifact_digest,
            cache_policy,
            spa_fallback,
            files,
        })
    }

    pub const fn release_id(&self) -> Uuid {
        self.release_id
    }

    pub fn project_slug(&self) -> &ProjectSlug {
        &self.project_slug
    }

    pub fn artifact_digest(&self) -> &ArtifactDigest {
        &self.artifact_digest
    }

    pub const fn cache_policy(&self) -> CachePolicy {
        self.cache_policy
    }

    pub const fn spa_fallback(&self) -> bool {
        self.spa_fallback
    }

    pub fn resolve_asset(
        &self,
        request_path: &str,
        accepts_html: bool,
    ) -> Result<Option<ResolvedAsset>, PreviewPathError> {
        let normalized = normalize_request_path(request_path)?;
        let exact = if normalized.is_empty() {
            "index.html".to_owned()
        } else {
            normalized.to_owned()
        };
        if let Some(file) = self.files.get(&exact) {
            return Ok(Some(ResolvedAsset::new(file.clone(), false)));
        }

        if !normalized.is_empty() {
            let directory_index = format!("{}/index.html", normalized.trim_end_matches('/'));
            if let Some(file) = self.files.get(&directory_index) {
                return Ok(Some(ResolvedAsset::new(file.clone(), false)));
            }
        }

        if self.spa_fallback && accepts_html {
            return Ok(self
                .files
                .get("index.html")
                .cloned()
                .map(|file| ResolvedAsset::new(file, true)));
        }
        Ok(None)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedAsset {
    pub path: String,
    pub size: u64,
    pub sha256: String,
    pub spa_fallback: bool,
}

impl ResolvedAsset {
    fn new(file: ManifestEntry, spa_fallback: bool) -> Self {
        Self {
            path: file.path,
            size: file.size,
            sha256: file.sha256,
            spa_fallback,
        }
    }
}

#[derive(Debug, Error, Clone, PartialEq, Eq)]
#[error("preview path is unsafe")]
pub struct PreviewPathError;

#[derive(Debug, Error)]
pub enum PreviewRepositoryError {
    #[error("preview metadata is corrupt")]
    CorruptRecord,
    #[error("preview repository is unavailable")]
    Unavailable {
        #[source]
        source: Box<dyn StdError + Send + Sync>,
    },
}

impl PreviewRepositoryError {
    pub fn unavailable(source: impl StdError + Send + Sync + 'static) -> Self {
        Self::Unavailable {
            source: Box::new(source),
        }
    }
}

#[async_trait]
pub trait PreviewRepository: Send + Sync + 'static {
    async fn find_ready_release(
        &self,
        project_slug: &ProjectSlug,
        release_id: Uuid,
    ) -> Result<Option<PreviewRelease>, PreviewRepositoryError>;

    async fn find_active_release(
        &self,
        project_slug: &ProjectSlug,
    ) -> Result<Option<PreviewRelease>, PreviewRepositoryError>;
}

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

fn error_response(status: StatusCode) -> Response<Body> {
    let mut response = Response::new(Body::empty());
    *response.status_mut() = status;
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    if status == StatusCode::SERVICE_UNAVAILABLE {
        response
            .headers_mut()
            .insert(header::RETRY_AFTER, HeaderValue::from_static("1"));
    }
    response
}

fn metadata_only_response(
    status: StatusCode,
    etag: &str,
    cache_control: &'static str,
    vary_accept: bool,
) -> Response<Body> {
    let mut response = Response::new(Body::empty());
    *response.status_mut() = status;
    insert_header(response.headers_mut(), header::ETAG, etag);
    response.headers_mut().insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static(cache_control),
    );
    response
        .headers_mut()
        .insert(header::ACCEPT_RANGES, HeaderValue::from_static("bytes"));
    if vary_accept {
        response
            .headers_mut()
            .insert(header::VARY, HeaderValue::from_static("Accept"));
    }
    response
}

fn range_not_satisfiable_response(
    size: u64,
    etag: &str,
    cache_control: &'static str,
    vary_accept: bool,
) -> Response<Body> {
    let mut response = metadata_only_response(
        StatusCode::RANGE_NOT_SATISFIABLE,
        etag,
        cache_control,
        vary_accept,
    );
    insert_header(
        response.headers_mut(),
        header::CONTENT_RANGE,
        format!("bytes */{size}"),
    );
    response
}

fn insert_header(headers: &mut HeaderMap, name: HeaderName, value: impl AsRef<str>) {
    if let Ok(value) = HeaderValue::from_str(value.as_ref()) {
        headers.insert(name, value);
    }
}

fn accepts_html(headers: &HeaderMap) -> bool {
    headers
        .get(header::ACCEPT)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|accept| {
            accept.split(',').any(|item| {
                let media_type = item.split(';').next().unwrap_or(item).trim();
                matches!(media_type, "text/html" | "application/xhtml+xml")
            })
        })
}

fn if_none_match(headers: &HeaderMap, etag: &str) -> bool {
    headers
        .get(header::IF_NONE_MATCH)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| {
            value.split(',').any(|candidate| {
                let candidate = candidate.trim();
                candidate == "*" || candidate.strip_prefix("W/").unwrap_or(candidate) == etag
            })
        })
}

fn content_type(path: &str) -> String {
    let mime = mime_guess::from_path(path).first_or_octet_stream();
    let value = mime.as_ref();
    if value.starts_with("text/")
        || value.ends_with("javascript")
        || value.ends_with("json")
        || value.ends_with("xml")
        || value.ends_with("svg+xml")
    {
        format!("{value}; charset=utf-8")
    } else {
        value.to_owned()
    }
}

fn cache_control(path: &str, policy: CachePolicy) -> &'static str {
    if path.ends_with(".html") {
        "no-cache"
    } else if policy == CachePolicy::Aggressive {
        "public, max-age=31536000, immutable"
    } else {
        "public, max-age=3600"
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RangeSelection {
    Full,
    Partial { start: u64, end: u64 },
    Unsatisfiable,
}

fn requested_range(method: &Method, headers: &HeaderMap, etag: &str, size: u64) -> RangeSelection {
    if method != Method::GET || size == 0 {
        return RangeSelection::Full;
    }
    let Some(range) = headers
        .get(header::RANGE)
        .and_then(|value| value.to_str().ok())
    else {
        return RangeSelection::Full;
    };
    if headers
        .get(header::IF_RANGE)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|if_range| if_range != etag)
    {
        return RangeSelection::Full;
    }
    let Some((unit, specification)) = range.split_once('=') else {
        return RangeSelection::Full;
    };
    if !unit.eq_ignore_ascii_case("bytes") || specification.contains(',') {
        return RangeSelection::Full;
    }
    let Some((first, last)) = specification.split_once('-') else {
        return RangeSelection::Full;
    };
    if last.contains('-') {
        return RangeSelection::Full;
    }

    if first.is_empty() {
        let Ok(suffix_length) = last.parse::<u64>() else {
            return RangeSelection::Full;
        };
        if suffix_length == 0 {
            return RangeSelection::Unsatisfiable;
        }
        return RangeSelection::Partial {
            start: size.saturating_sub(suffix_length),
            end: size - 1,
        };
    }

    let Ok(start) = first.parse::<u64>() else {
        return RangeSelection::Full;
    };
    if start >= size {
        return RangeSelection::Unsatisfiable;
    }
    let end = if last.is_empty() {
        size - 1
    } else {
        let Ok(end) = last.parse::<u64>() else {
            return RangeSelection::Full;
        };
        if end < start {
            return RangeSelection::Full;
        }
        end.min(size - 1)
    };
    RangeSelection::Partial { start, end }
}

fn normalize_request_path(value: &str) -> Result<&str, PreviewPathError> {
    let normalized = value.strip_prefix('/').unwrap_or(value);
    let path = normalized.strip_suffix('/').unwrap_or(normalized);
    if path.is_empty() {
        return Ok("");
    }
    valid_path_components(path)
        .then_some(path)
        .ok_or(PreviewPathError)
}

fn valid_asset_path(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= MAX_ASSET_PATH_BYTES
        && !value.starts_with('/')
        && !value.ends_with('/')
        && valid_path_components(value)
}

fn valid_path_components(value: &str) -> bool {
    !value.contains(['\\', '\0'])
        && !value.chars().any(char::is_control)
        && value.split('/').all(|component| {
            !component.is_empty()
                && !matches!(component, "." | "..")
                && !component.contains(':')
                && !component.ends_with([' ', '.'])
        })
}

fn expected_storage_key(digest: &ArtifactDigest) -> String {
    let digest = digest.as_str();
    format!(
        "blobs/sha256/{}/{}/{}",
        &digest[0..2],
        &digest[2..4],
        digest
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        body::to_bytes,
        http::{Request, header},
    };
    use tempfile::TempDir;
    use tower::ServiceExt;

    fn release(spa_fallback: bool) -> PreviewRelease {
        release_with_policy(spa_fallback, CachePolicy::Standard)
    }

    fn release_with_policy(spa_fallback: bool, cache_policy: CachePolicy) -> PreviewRelease {
        let artifact_digest = ArtifactDigest::parse("ab".repeat(32)).unwrap();
        let files = vec![
            entry("assets/app.js", b"console.log('ready')"),
            entry("docs/index.html", b"docs"),
            entry("index.html", b"home"),
        ];
        let total_size = files.iter().map(|file| file.size).sum();
        PreviewRelease::try_new(
            Uuid::from_u128(10),
            ProjectSlug::parse("marketing").unwrap(),
            artifact_digest.clone(),
            &expected_storage_key(&artifact_digest),
            cache_policy,
            spa_fallback,
            files.len() as u32,
            total_size,
            ArtifactManifest { version: 1, files },
        )
        .unwrap()
    }

    #[derive(Clone)]
    struct StaticRepository {
        release: PreviewRelease,
    }

    #[async_trait]
    impl PreviewRepository for StaticRepository {
        async fn find_ready_release(
            &self,
            project_slug: &ProjectSlug,
            release_id: Uuid,
        ) -> Result<Option<PreviewRelease>, PreviewRepositoryError> {
            Ok((self.release.project_slug() == project_slug
                && self.release.release_id() == release_id)
                .then(|| self.release.clone()))
        }

        async fn find_active_release(
            &self,
            project_slug: &ProjectSlug,
        ) -> Result<Option<PreviewRelease>, PreviewRepositoryError> {
            Ok((self.release.project_slug() == project_slug).then(|| self.release.clone()))
        }
    }

    async fn http_fixture(cache_policy: CachePolicy) -> (Router, TempDir, Uuid) {
        let release = release_with_policy(true, cache_policy);
        let release_id = release.release_id();
        let temp = tempfile::tempdir().unwrap();
        let storage = LocalArtifactStore::new(temp.path());
        storage.ensure_layout().await.unwrap();
        let root = storage.artifact_path(release.artifact_digest());
        tokio::fs::create_dir_all(root.join("assets"))
            .await
            .unwrap();
        tokio::fs::create_dir_all(root.join("docs")).await.unwrap();
        tokio::fs::write(root.join("index.html"), b"home")
            .await
            .unwrap();
        tokio::fs::write(root.join("docs/index.html"), b"docs")
            .await
            .unwrap();
        tokio::fs::write(root.join("assets/app.js"), b"console.log('ready')")
            .await
            .unwrap();
        let service = PreviewService::new(Arc::new(StaticRepository { release }), storage);
        (build_router(service), temp, release_id)
    }

    fn entry(path: &str, contents: &[u8]) -> ManifestEntry {
        let byte = contents.len() % 16;
        ManifestEntry {
            path: path.to_owned(),
            size: contents.len() as u64,
            sha256: format!("{byte:x}").repeat(64),
        }
    }

    #[test]
    fn resolves_roots_exact_assets_directory_indexes_and_spa_routes() {
        let release = release(true);
        assert_eq!(
            release.resolve_asset("", false).unwrap().unwrap().path,
            "index.html"
        );
        assert_eq!(
            release
                .resolve_asset("assets/app.js", false)
                .unwrap()
                .unwrap()
                .path,
            "assets/app.js"
        );
        assert_eq!(
            release.resolve_asset("docs/", false).unwrap().unwrap().path,
            "docs/index.html"
        );
        let fallback = release
            .resolve_asset("dashboard/settings", true)
            .unwrap()
            .unwrap();
        assert_eq!(fallback.path, "index.html");
        assert!(fallback.spa_fallback);
        assert_eq!(
            release.resolve_asset("assets/missing.js", false).unwrap(),
            None
        );
    }

    #[test]
    fn rejects_request_traversal_and_nonportable_separators() {
        let release = release(true);
        for path in ["../secret", "assets/../secret", "..\\secret", "a//b"] {
            assert!(release.resolve_asset(path, true).is_err(), "{path}");
        }
    }

    #[test]
    fn rejects_inconsistent_or_unsafe_manifests() {
        let digest = ArtifactDigest::parse("cd".repeat(32)).unwrap();
        let valid = entry("index.html", b"home");
        let build = |storage_key: &str, files: Vec<ManifestEntry>| {
            PreviewRelease::try_new(
                Uuid::nil(),
                ProjectSlug::parse("demo").unwrap(),
                digest.clone(),
                storage_key,
                CachePolicy::Aggressive,
                true,
                files.len() as u32,
                files.iter().map(|file| file.size).sum(),
                ArtifactManifest { version: 1, files },
            )
        };
        assert_eq!(
            build("wrong", vec![valid.clone()]).unwrap_err(),
            PreviewReleaseError::InvalidArtifactMetadata
        );
        let mut unsafe_entry = valid.clone();
        unsafe_entry.path = "../index.html".to_owned();
        assert_eq!(
            build(&expected_storage_key(&digest), vec![unsafe_entry]).unwrap_err(),
            PreviewReleaseError::InvalidManifest
        );
        assert_eq!(
            build(
                &expected_storage_key(&digest),
                vec![entry("app.js", b"app")]
            )
            .unwrap_err(),
            PreviewReleaseError::MissingIndex
        );
    }

    #[tokio::test]
    async fn serves_get_head_and_conditional_requests_with_stable_metadata() {
        let (app, _temp, release_id) = http_fixture(CachePolicy::Standard).await;
        let url = format!("/_sites/marketing/{release_id}/");
        let response = app
            .clone()
            .oneshot(Request::get(&url).body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response.headers()[header::CONTENT_TYPE],
            "text/html; charset=utf-8"
        );
        assert_eq!(response.headers()[header::CACHE_CONTROL], "no-cache");
        assert_eq!(response.headers()[header::CONTENT_LENGTH], "4");
        let etag = response.headers()[header::ETAG].clone();
        assert_eq!(to_bytes(response.into_body(), 16).await.unwrap(), "home");

        let head = app
            .clone()
            .oneshot(Request::head(&url).body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(head.status(), StatusCode::OK);
        assert_eq!(head.headers()[header::CONTENT_LENGTH], "4");
        assert!(to_bytes(head.into_body(), 16).await.unwrap().is_empty());

        let not_modified = app
            .oneshot(
                Request::get(&url)
                    .header(
                        header::IF_NONE_MATCH,
                        format!("W/{}", etag.to_str().unwrap()),
                    )
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(not_modified.status(), StatusCode::NOT_MODIFIED);
        assert!(
            to_bytes(not_modified.into_body(), 16)
                .await
                .unwrap()
                .is_empty()
        );
    }

    #[tokio::test]
    async fn serves_the_database_selected_active_release_at_the_project_path() {
        let (app, _temp, _release_id) = http_fixture(CachePolicy::Standard).await;
        let root = app
            .clone()
            .oneshot(Request::get("/marketing/").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(root.status(), StatusCode::OK);
        assert_eq!(root.headers()[header::CACHE_CONTROL], "no-cache");
        assert_eq!(to_bytes(root.into_body(), 16).await.unwrap(), "home");

        let deep_link = app
            .oneshot(
                Request::get("/marketing/dashboard/settings")
                    .header(header::ACCEPT, "text/html")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(deep_link.status(), StatusCode::OK);
        assert_eq!(deep_link.headers()[header::VARY], "Accept");
        assert_eq!(to_bytes(deep_link.into_body(), 16).await.unwrap(), "home");
    }

    #[tokio::test]
    async fn serves_single_byte_ranges_and_honors_if_range() {
        let (app, _temp, release_id) = http_fixture(CachePolicy::Aggressive).await;
        let url = format!("/_sites/marketing/{release_id}/assets/app.js");
        let etag = format!(
            "\"{}\"",
            entry("assets/app.js", b"console.log('ready')").sha256
        );
        let partial = app
            .clone()
            .oneshot(
                Request::get(&url)
                    .header(header::RANGE, "bytes=2-5")
                    .header(header::IF_RANGE, &etag)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(partial.status(), StatusCode::PARTIAL_CONTENT);
        assert_eq!(partial.headers()[header::CONTENT_RANGE], "bytes 2-5/20");
        assert_eq!(partial.headers()[header::CONTENT_LENGTH], "4");
        assert_eq!(
            partial.headers()[header::CACHE_CONTROL],
            "public, max-age=31536000, immutable"
        );
        assert_eq!(to_bytes(partial.into_body(), 16).await.unwrap(), "nsol");

        let changed = app
            .clone()
            .oneshot(
                Request::get(&url)
                    .header(header::RANGE, "bytes=2-5")
                    .header(header::IF_RANGE, "\"different\"")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(changed.status(), StatusCode::OK);
        assert_eq!(changed.headers()[header::CONTENT_LENGTH], "20");

        let unsatisfiable = app
            .oneshot(
                Request::get(&url)
                    .header(header::RANGE, "bytes=999-")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(unsatisfiable.status(), StatusCode::RANGE_NOT_SATISFIABLE);
        assert_eq!(unsatisfiable.headers()[header::CONTENT_RANGE], "bytes */20");
    }

    #[tokio::test]
    async fn limits_spa_fallback_to_html_navigation_and_rejects_unsafe_paths() {
        let (app, _temp, release_id) = http_fixture(CachePolicy::Standard).await;
        let deep_link = format!("/_sites/marketing/{release_id}/dashboard/settings");
        let fallback = app
            .clone()
            .oneshot(
                Request::get(&deep_link)
                    .header(header::ACCEPT, "text/html,application/xhtml+xml")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(fallback.status(), StatusCode::OK);
        assert_eq!(fallback.headers()[header::VARY], "Accept");
        assert_eq!(to_bytes(fallback.into_body(), 16).await.unwrap(), "home");

        let missing_asset = app
            .clone()
            .oneshot(
                Request::get(format!("/_sites/marketing/{release_id}/assets/missing.js"))
                    .header(header::ACCEPT, "*/*")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(missing_asset.status(), StatusCode::NOT_FOUND);
        assert_eq!(missing_asset.headers()[header::CACHE_CONTROL], "no-store");

        let traversal = app
            .oneshot(
                Request::get(format!(
                    "/_sites/marketing/{release_id}/%2e%2e%5csecret.txt"
                ))
                .header(header::ACCEPT, "text/html")
                .body(Body::empty())
                .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(traversal.status(), StatusCode::NOT_FOUND);
    }
}
