use axum::{
    body::{Body, to_bytes},
    http::{Request, StatusCode, header},
};
use tower::ServiceExt;

use super::*;

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

    let rejected_fallback = app
        .clone()
        .oneshot(
            Request::get(&deep_link)
                .header(header::ACCEPT, "text/html;q=0, application/json")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(rejected_fallback.status(), StatusCode::NOT_FOUND);

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
