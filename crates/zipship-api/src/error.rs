use axum::{
    Json,
    http::{HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
};
use serde::Serialize;
use utoipa::ToSchema;

#[derive(Debug, Serialize, ToSchema)]
pub(crate) struct ErrorResponse {
    pub code: &'static str,
}

#[derive(Debug)]
pub(crate) struct ApiError {
    status: StatusCode,
    code: &'static str,
}

impl ApiError {
    pub const fn new(status: StatusCode, code: &'static str) -> Self {
        Self { status, code }
    }

    pub const fn invalid_json() -> Self {
        Self::new(StatusCode::BAD_REQUEST, "INVALID_JSON")
    }

    pub const fn invalid_path_parameter() -> Self {
        Self::new(StatusCode::BAD_REQUEST, "INVALID_PATH_PARAMETER")
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (
            self.status,
            [(header::CACHE_CONTROL, HeaderValue::from_static("no-store"))],
            Json(ErrorResponse { code: self.code }),
        )
            .into_response()
    }
}
