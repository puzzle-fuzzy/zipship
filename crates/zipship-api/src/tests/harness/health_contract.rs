use super::*;

#[tokio::test]
async fn liveness_does_not_depend_on_external_services() {
    let app = test_app(CheckStatus::Failed, false).await;
    let response = app
        .oneshot(Request::get("/_health/live").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert!(response.headers().contains_key("x-request-id"));
}

#[tokio::test]
async fn readiness_reports_dependency_failures() {
    let app = test_app(CheckStatus::Failed, false).await;
    let response = app
        .oneshot(Request::get("/_health/ready").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
}

#[tokio::test]
async fn cors_allows_only_configured_credentialed_console_origins() {
    let app = test_app(CheckStatus::Ok, false).await;
    let preflight = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::OPTIONS)
                .uri("/_api/projects/project/releases/release/publish")
                .header(header::ORIGIN, "http://127.0.0.1:4015")
                .header(header::ACCESS_CONTROL_REQUEST_METHOD, "POST")
                .header(
                    header::ACCESS_CONTROL_REQUEST_HEADERS,
                    "authorization,content-type,idempotency-key,x-csrf-token",
                )
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(preflight.status(), StatusCode::OK);
    assert_eq!(
        preflight.headers()[header::ACCESS_CONTROL_ALLOW_ORIGIN],
        "http://127.0.0.1:4015"
    );
    assert_eq!(
        preflight.headers()[header::ACCESS_CONTROL_ALLOW_CREDENTIALS],
        "true"
    );
    assert!(
        preflight.headers()[header::ACCESS_CONTROL_ALLOW_HEADERS]
            .to_str()
            .unwrap()
            .split(',')
            .map(str::trim)
            .any(|value| value.eq_ignore_ascii_case("authorization"))
    );

    let rejected = app
        .oneshot(
            Request::get("/_health/live")
                .header(header::ORIGIN, "https://untrusted.example")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(rejected.status(), StatusCode::OK);
    assert!(
        rejected
            .headers()
            .get(header::ACCESS_CONTROL_ALLOW_ORIGIN)
            .is_none()
    );
}

#[tokio::test]
async fn publishes_the_openapi_contract() {
    let app = test_app(CheckStatus::Ok, false).await;
    let response = app
        .oneshot(
            Request::get("/_api/openapi.json")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response
            .headers()
            .get(header::CONTENT_TYPE)
            .unwrap()
            .to_str()
            .unwrap(),
        "application/json",
    );
    const OPENAPI_MAX_BYTES: usize = 256 * 1_024;
    let body = to_bytes(response.into_body(), OPENAPI_MAX_BYTES)
        .await
        .unwrap();
    assert!(body.len() < OPENAPI_MAX_BYTES);
    let document: Value = serde_json::from_slice(&body).unwrap();
    assert!(document["paths"]["/_api/auth/register"].is_object());
    assert!(document["paths"]["/_api/auth/logout"].is_object());
    assert!(document["paths"]["/_api/auth/password-resets"].is_object());
    assert!(document["paths"]["/_api/auth/password-resets/confirm"].is_object());
    assert!(
        document["paths"]["/_api/projects/{project_id}/releases/{release_id}/publish"].is_object()
    );
    assert!(document["paths"]["/_api/projects/{project_id}/deployments"].is_object());
    assert!(document["paths"]["/_api/projects/{project_id}/releases"].is_object());
    assert!(document["paths"]["/_api/organizations"].is_object());
    assert!(
        document["paths"]["/_api/organizations/{organization_id}/members/{user_id}"].is_object()
    );
    assert!(document["paths"]["/_api/projects/{project_id}"].is_object());
    assert!(document["paths"]["/_api/projects/{project_id}/uploads"].is_object());
    assert!(document["paths"]["/_api/uploads/{upload_id}/content"].is_object());
    assert!(document["paths"]["/_api/api-tokens"].is_object());
    assert!(document["paths"]["/_api/api-tokens/{token_id}"].is_object());
    assert!(document["components"]["securitySchemes"]["cookieAuth"].is_object());
    assert_eq!(
        document["components"]["securitySchemes"]["apiToken"]["scheme"],
        "bearer"
    );
    assert_eq!(
        document["paths"]["/_api/projects/{project_id}"]["get"]["security"],
        json!([{ "cookieAuth": [] }, { "apiToken": [] }])
    );
}

#[test]
fn committed_openapi_snapshot_matches_the_rust_contract() {
    let expected: Value = serde_json::from_str(include_str!(
        "../../../../../packages/api-client/openapi/zipship.json"
    ))
    .unwrap();
    let actual = serde_json::to_value(openapi_document()).unwrap();
    assert_eq!(
        actual, expected,
        "Rust API contract changed; run `bun run api:generate`"
    );
}
