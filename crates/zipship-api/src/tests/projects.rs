use super::*;

#[tokio::test]
async fn project_routes_require_session_and_csrf() {
    let app = test_app(CheckStatus::Ok, false).await;
    let registered = app.clone().oneshot(register_request()).await.unwrap();
    let session = response_cookie(&registered, "zipship_session");
    let csrf = response_cookie(&registered, "zipship_csrf");
    let cookie_header = format!("{}; {}", cookie_pair(&session), cookie_pair(&csrf));

    let organizations = app
        .clone()
        .oneshot(
            Request::get("/_api/organizations")
                .header(header::COOKIE, &cookie_header)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(organizations.status(), StatusCode::OK);
    assert_eq!(
        json_body(organizations).await["organizations"][0]["id"],
        TEST_ORGANIZATION_ID.to_string(),
    );

    let project_path = format!("/_api/organizations/{TEST_ORGANIZATION_ID}/projects");
    let request_body = json!({
        "name": " Marketing Site ",
        "slug": " Marketing-Site ",
        "description": " Campaign frontend "
    })
    .to_string();
    let missing_csrf = app
        .clone()
        .oneshot(
            Request::post(&project_path)
                .header(header::COOKIE, &cookie_header)
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(request_body.clone()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(missing_csrf.status(), StatusCode::FORBIDDEN);

    let created = app
        .clone()
        .oneshot(
            Request::post(&project_path)
                .header(header::COOKIE, &cookie_header)
                .header(header::CONTENT_TYPE, "application/json")
                .header("x-csrf-token", cookie_value(&csrf))
                .body(Body::from(request_body))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(created.status(), StatusCode::CREATED);
    let created = json_body(created).await;
    assert_eq!(created["project"]["slug"], "marketing-site");
    let project_id = created["project"]["id"].as_str().unwrap();

    let detail = app
        .clone()
        .oneshot(
            Request::get(format!("/_api/projects/{project_id}"))
                .header(header::COOKIE, &cookie_header)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(detail.status(), StatusCode::OK);

    let update_body = json!({
        "name": " Product Site ",
        "slug": " Product-Site ",
        "description": null,
        "spaFallback": false,
        "cachePolicy": "aggressive"
    })
    .to_string();
    let missing_update_csrf = app
        .clone()
        .oneshot(
            Request::patch(format!("/_api/projects/{project_id}"))
                .header(header::COOKIE, &cookie_header)
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(update_body.clone()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(missing_update_csrf.status(), StatusCode::FORBIDDEN);
    let updated = app
        .clone()
        .oneshot(
            Request::patch(format!("/_api/projects/{project_id}"))
                .header(header::COOKIE, &cookie_header)
                .header(header::CONTENT_TYPE, "application/json")
                .header("x-csrf-token", cookie_value(&csrf))
                .body(Body::from(update_body))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(updated.status(), StatusCode::OK);
    let updated = json_body(updated).await;
    assert_eq!(updated["project"]["name"], "Product Site");
    assert_eq!(updated["project"]["slug"], "product-site");
    assert!(updated["project"]["description"].is_null());
    assert_eq!(updated["project"]["spaFallback"], false);
    assert_eq!(updated["project"]["cachePolicy"], "aggressive");

    let null_name = app
        .clone()
        .oneshot(
            Request::patch(format!("/_api/projects/{project_id}"))
                .header(header::COOKIE, &cookie_header)
                .header(header::CONTENT_TYPE, "application/json")
                .header("x-csrf-token", cookie_value(&csrf))
                .body(Body::from(json!({ "name": null }).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(null_name.status(), StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(
        json_body(null_name).await,
        json!({ "code": "INVALID_PROJECT_INPUT" })
    );

    let invalid_path = app
        .oneshot(
            Request::get("/_api/projects/not-a-uuid")
                .header(header::COOKIE, cookie_header)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(invalid_path.status(), StatusCode::BAD_REQUEST);
    assert_eq!(
        json_body(invalid_path).await,
        json!({ "code": "INVALID_PATH_PARAMETER" }),
    );
}
