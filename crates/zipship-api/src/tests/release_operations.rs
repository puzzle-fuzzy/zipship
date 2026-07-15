use super::*;

#[tokio::test]
async fn release_routes_expose_immutable_metadata_without_storage_paths() {
    let app = test_app(CheckStatus::Ok, false).await;
    let registered = app.clone().oneshot(register_request()).await.unwrap();
    let session = response_cookie(&registered, "zipship_session");
    let csrf = response_cookie(&registered, "zipship_csrf");
    let cookie_header = format!("{}; {}", cookie_pair(&session), cookie_pair(&csrf));
    let project_id = Uuid::from_u128(90);

    let response = app
        .oneshot(
            Request::get(format!("/_api/projects/{project_id}/releases"))
                .header(header::COOKIE, cookie_header)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let response = json_body(response).await;
    let release = &response["releases"][0];
    assert_eq!(release["state"], "ready");
    assert_eq!(release["isActive"], true);
    assert_eq!(
        release["previewPath"],
        format!("/_sites/marketing/{}/", Uuid::from_u128(91))
    );
    assert_eq!(
        release["artifact"]["manifest"]["files"][0]["path"],
        "index.html"
    );
    assert!(release.get("storageKey").is_none());
    assert!(release.get("storagePath").is_none());
}

#[tokio::test]
async fn audit_routes_expose_safe_cursor_paginated_activity() {
    let app = test_app(CheckStatus::Ok, false).await;
    let registered = app.clone().oneshot(register_request()).await.unwrap();
    let session = response_cookie(&registered, "zipship_session");
    let csrf = response_cookie(&registered, "zipship_csrf");
    let cookie_header = format!("{}; {}", cookie_pair(&session), cookie_pair(&csrf));
    let project_id = Uuid::from_u128(70);
    let path = format!(
        "/_api/organizations/{TEST_ORGANIZATION_ID}/audit-logs?limit=1&projectId={project_id}"
    );

    let response = app
        .clone()
        .oneshot(
            Request::get(path)
                .header(header::COOKIE, &cookie_header)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let response = json_body(response).await;
    let entry = &response["items"][0];
    assert_eq!(entry["projectId"], project_id.to_string());
    assert_eq!(entry["actor"]["displayName"], "Owner");
    assert_eq!(entry["action"], "release.published");
    assert_eq!(entry["metadata"]["versionNumber"], 2);
    assert!(entry.get("ipAddress").is_none());
    assert!(entry.get("userAgent").is_none());
    assert!(response["nextCursor"].is_null());

    let invalid = app
        .oneshot(
            Request::get(format!(
                "/_api/organizations/{TEST_ORGANIZATION_ID}/audit-logs?limit=0"
            ))
            .header(header::COOKIE, cookie_header)
            .body(Body::empty())
            .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(invalid.status(), StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(
        json_body(invalid).await,
        json!({ "code": "INVALID_AUDIT_QUERY" })
    );
}

#[tokio::test]
async fn deployment_routes_require_csrf_and_idempotency_and_list_history() {
    let app = test_app(CheckStatus::Ok, false).await;
    let registered = app.clone().oneshot(register_request()).await.unwrap();
    let session = response_cookie(&registered, "zipship_session");
    let csrf = response_cookie(&registered, "zipship_csrf");
    let cookie_header = format!("{}; {}", cookie_pair(&session), cookie_pair(&csrf));
    let project_id = Uuid::from_u128(80);
    let release_id = Uuid::from_u128(81);
    let publish_path = format!("/_api/projects/{project_id}/releases/{release_id}/publish");
    let body = json!({ "message": " Production release " }).to_string();

    let missing_csrf = app
        .clone()
        .oneshot(
            Request::post(&publish_path)
                .header(header::COOKIE, &cookie_header)
                .header(header::CONTENT_TYPE, "application/json")
                .header("idempotency-key", "publish-81")
                .body(Body::from(body.clone()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(missing_csrf.status(), StatusCode::FORBIDDEN);

    let missing_idempotency_key = app
        .clone()
        .oneshot(
            Request::post(&publish_path)
                .header(header::COOKIE, &cookie_header)
                .header(header::CONTENT_TYPE, "application/json")
                .header("x-csrf-token", cookie_value(&csrf))
                .body(Body::from(body.clone()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(
        missing_idempotency_key.status(),
        StatusCode::UNPROCESSABLE_ENTITY
    );
    assert_eq!(
        json_body(missing_idempotency_key).await,
        json!({ "code": "INVALID_DEPLOYMENT_INPUT" }),
    );

    let published = app
        .clone()
        .oneshot(
            Request::post(&publish_path)
                .header(header::COOKIE, &cookie_header)
                .header(header::CONTENT_TYPE, "application/json")
                .header("x-csrf-token", cookie_value(&csrf))
                .header("idempotency-key", "publish-81")
                .header("x-request-id", Uuid::from_u128(82).to_string())
                .body(Body::from(body))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(published.status(), StatusCode::OK);
    assert_eq!(published.headers()[header::CACHE_CONTROL], "no-store");
    let published = json_body(published).await;
    assert_eq!(published["deployment"]["action"], "publish");
    assert_eq!(published["deployment"]["message"], "Production release");
    assert_eq!(published["activeReleaseId"], release_id.to_string());
    assert_eq!(published["replayed"], false);

    let rollback_path = format!("/_api/projects/{project_id}/releases/{release_id}/rollback");
    let rolled_back = app
        .clone()
        .oneshot(
            Request::post(rollback_path)
                .header(header::COOKIE, &cookie_header)
                .header(header::CONTENT_TYPE, "application/json")
                .header("x-csrf-token", cookie_value(&csrf))
                .header("idempotency-key", "rollback-81")
                .body(Body::from("{}"))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(rolled_back.status(), StatusCode::OK);
    assert_eq!(
        json_body(rolled_back).await["deployment"]["action"],
        "rollback"
    );

    let history = app
        .oneshot(
            Request::get(format!("/_api/projects/{project_id}/deployments"))
                .header(header::COOKIE, cookie_header)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(history.status(), StatusCode::OK);
    let history = json_body(history).await;
    assert_eq!(history["deployments"].as_array().unwrap().len(), 2);
    assert_eq!(history["deployments"][0]["action"], "rollback");
}
