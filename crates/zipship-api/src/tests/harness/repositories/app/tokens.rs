use super::*;

#[tokio::test]
async fn api_token_routes_expose_secrets_once_and_revoke_idempotently() {
    let app = test_app(CheckStatus::Ok, false).await;
    let registered = app.clone().oneshot(register_request()).await.unwrap();
    let session = response_cookie(&registered, "zipship_session");
    let csrf = response_cookie(&registered, "zipship_csrf");
    let cookie_header = format!("{}; {}", cookie_pair(&session), cookie_pair(&csrf));
    let request_body = json!({
        "name": " Deployment automation ",
        "scopes": ["projects:read"],
        "expiresInDays": 30
    })
    .to_string();

    let missing_csrf = app
        .clone()
        .oneshot(
            Request::post("/_api/api-tokens")
                .header(header::COOKIE, &cookie_header)
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(request_body.clone()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(missing_csrf.status(), StatusCode::FORBIDDEN);
    assert_eq!(
        json_body(missing_csrf).await,
        json!({ "code": "INVALID_CSRF_TOKEN" })
    );

    let created = app
        .clone()
        .oneshot(
            Request::post("/_api/api-tokens")
                .header(header::COOKIE, &cookie_header)
                .header(header::CONTENT_TYPE, "application/json")
                .header("x-csrf-token", cookie_value(&csrf))
                .body(Body::from(request_body))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(created.status(), StatusCode::CREATED);
    assert_eq!(created.headers()[header::CACHE_CONTROL], "no-store");
    let created = json_body(created).await;
    let token_id = created["apiToken"]["id"].as_str().unwrap().to_owned();
    let secret = created["secret"].as_str().unwrap().to_owned();
    assert!(secret.starts_with("zps_"));
    assert_eq!(created["apiToken"]["name"], "Deployment automation");
    assert_eq!(created["apiToken"]["state"], "active");
    assert_eq!(
        created["apiToken"]["displayPrefix"].as_str().unwrap().len(),
        12
    );
    assert!(created["apiToken"].get("tokenDigest").is_none());

    let listed = app
        .clone()
        .oneshot(
            Request::get("/_api/api-tokens")
                .header(header::COOKIE, &cookie_header)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(listed.status(), StatusCode::OK);
    assert_eq!(listed.headers()[header::CACHE_CONTROL], "no-store");
    let listed = json_body(listed).await;
    assert_eq!(listed["apiTokens"][0]["id"], token_id);
    assert!(listed["apiTokens"][0].get("secret").is_none());
    assert!(listed["apiTokens"][0].get("tokenDigest").is_none());

    let bearer_cannot_manage_tokens = app
        .clone()
        .oneshot(
            Request::get("/_api/api-tokens")
                .header(header::AUTHORIZATION, format!("Bearer {secret}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(
        bearer_cannot_manage_tokens.status(),
        StatusCode::UNAUTHORIZED
    );

    let bearer_can_read_projects = app
        .clone()
        .oneshot(
            Request::get(format!(
                "/_api/organizations/{TEST_ORGANIZATION_ID}/projects"
            ))
            .header(header::AUTHORIZATION, format!("Bearer {secret}"))
            .body(Body::empty())
            .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(bearer_can_read_projects.status(), StatusCode::OK);

    let missing_revoke_csrf = app
        .clone()
        .oneshot(
            Request::delete(format!("/_api/api-tokens/{token_id}"))
                .header(header::COOKIE, &cookie_header)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(missing_revoke_csrf.status(), StatusCode::FORBIDDEN);

    for _ in 0..2 {
        let revoked = app
            .clone()
            .oneshot(
                Request::delete(format!("/_api/api-tokens/{token_id}"))
                    .header(header::COOKIE, &cookie_header)
                    .header("x-csrf-token", cookie_value(&csrf))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(revoked.status(), StatusCode::NO_CONTENT);
        assert_eq!(revoked.headers()[header::CACHE_CONTROL], "no-store");
    }

    let rejected_after_revoke = app
        .clone()
        .oneshot(
            Request::get(format!(
                "/_api/organizations/{TEST_ORGANIZATION_ID}/projects"
            ))
            .header(header::AUTHORIZATION, format!("Bearer {secret}"))
            .body(Body::empty())
            .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(rejected_after_revoke.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(
        json_body(rejected_after_revoke).await,
        json!({ "code": "UNAUTHENTICATED" })
    );

    let listed_after_revoke = app
        .oneshot(
            Request::get("/_api/api-tokens")
                .header(header::COOKIE, cookie_header)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let listed_after_revoke = json_body(listed_after_revoke).await;
    assert_eq!(listed_after_revoke["apiTokens"][0]["state"], "revoked");
    assert!(listed_after_revoke["apiTokens"][0].get("secret").is_none());
}

#[tokio::test]
async fn bearer_tokens_intersect_scopes_with_current_project_access() {
    let app = test_app(CheckStatus::Ok, false).await;
    let owner_registration = app.clone().oneshot(register_request()).await.unwrap();
    let owner_session = response_cookie(&owner_registration, "zipship_session");
    let owner_csrf = response_cookie(&owner_registration, "zipship_csrf");
    let owner_cookie = format!(
        "{}; {}",
        cookie_pair(&owner_session),
        cookie_pair(&owner_csrf)
    );

    let project = app
        .clone()
        .oneshot(
            Request::post(format!(
                "/_api/organizations/{TEST_ORGANIZATION_ID}/projects"
            ))
            .header(header::COOKIE, &owner_cookie)
            .header(header::CONTENT_TYPE, "application/json")
            .header("x-csrf-token", cookie_value(&owner_csrf))
            .body(Body::from(
                json!({ "name": "Token Project", "slug": "token-project" }).to_string(),
            ))
            .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(project.status(), StatusCode::CREATED);
    let project_id = json_body(project).await["project"]["id"]
        .as_str()
        .unwrap()
        .to_owned();

    let owner_token = app
        .clone()
        .oneshot(
            Request::post("/_api/api-tokens")
                .header(header::COOKIE, &owner_cookie)
                .header(header::CONTENT_TYPE, "application/json")
                .header("x-csrf-token", cookie_value(&owner_csrf))
                .body(Body::from(
                    json!({
                        "name": "Read projects",
                        "scopes": ["projects:read"],
                        "expiresInDays": 30
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    let owner_secret = json_body(owner_token).await["secret"]
        .as_str()
        .unwrap()
        .to_owned();

    let allowed = app
        .clone()
        .oneshot(
            Request::get(format!("/_api/projects/{project_id}"))
                .header(header::AUTHORIZATION, format!("Bearer {owner_secret}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(allowed.status(), StatusCode::OK);

    let scope_cannot_fall_back_to_cookie = app
        .clone()
        .oneshot(
            Request::get(format!("/_api/projects/{project_id}/releases"))
                .header(header::COOKIE, &owner_cookie)
                .header(header::AUTHORIZATION, format!("Bearer {owner_secret}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(
        scope_cannot_fall_back_to_cookie.status(),
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        json_body(scope_cannot_fall_back_to_cookie).await,
        json!({ "code": "API_TOKEN_SCOPE_FORBIDDEN" })
    );

    let invalid_bearer_cannot_fall_back_to_cookie = app
        .clone()
        .oneshot(
            Request::get(format!("/_api/projects/{project_id}"))
                .header(header::COOKIE, &owner_cookie)
                .header(header::AUTHORIZATION, "Bearer invalid")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(
        invalid_bearer_cannot_fall_back_to_cookie.status(),
        StatusCode::UNAUTHORIZED
    );

    let bearer_cannot_update_projects = app
        .clone()
        .oneshot(
            Request::patch(format!("/_api/projects/{project_id}"))
                .header(header::AUTHORIZATION, format!("Bearer {owner_secret}"))
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(json!({ "name": "Denied" }).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(
        bearer_cannot_update_projects.status(),
        StatusCode::UNAUTHORIZED
    );

    let other_registration = app
        .clone()
        .oneshot(register_request_for("other@example.com", "Other"))
        .await
        .unwrap();
    let other_session = response_cookie(&other_registration, "zipship_session");
    let other_csrf = response_cookie(&other_registration, "zipship_csrf");
    let other_cookie = format!(
        "{}; {}",
        cookie_pair(&other_session),
        cookie_pair(&other_csrf)
    );
    let other_token = app
        .clone()
        .oneshot(
            Request::post("/_api/api-tokens")
                .header(header::COOKIE, other_cookie)
                .header(header::CONTENT_TYPE, "application/json")
                .header("x-csrf-token", cookie_value(&other_csrf))
                .body(Body::from(
                    json!({
                        "name": "Other user token",
                        "scopes": ["projects:read"],
                        "expiresInDays": 30
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    let other_secret = json_body(other_token).await["secret"]
        .as_str()
        .unwrap()
        .to_owned();
    let forbidden_by_live_access = app
        .oneshot(
            Request::get(format!("/_api/projects/{project_id}"))
                .header(header::AUTHORIZATION, format!("Bearer {other_secret}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(forbidden_by_live_access.status(), StatusCode::NOT_FOUND);
    assert_eq!(
        json_body(forbidden_by_live_access).await,
        json!({ "code": "PROJECT_NOT_FOUND" })
    );
}
