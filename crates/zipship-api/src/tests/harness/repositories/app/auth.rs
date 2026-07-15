use super::*;

#[tokio::test]
async fn registration_issues_hardened_session_cookies() {
    let app = test_app(CheckStatus::Ok, true).await;
    let response = app.oneshot(register_request()).await.unwrap();
    assert_eq!(response.status(), StatusCode::CREATED);
    assert_eq!(
        response.headers().get(header::CACHE_CONTROL).unwrap(),
        "no-store",
    );

    let session = response_cookie(&response, "zipship_session");
    let csrf = response_cookie(&response, "zipship_csrf");
    let session_lower = session.to_ascii_lowercase();
    let csrf_lower = csrf.to_ascii_lowercase();
    assert!(session_lower.contains("httponly"));
    assert!(!csrf_lower.contains("httponly"));
    for cookie in [&session_lower, &csrf_lower] {
        assert!(cookie.contains("secure"));
        assert!(cookie.contains("samesite=strict"));
        assert!(cookie.contains("path=/"));
        assert!(cookie.contains("max-age=604800"));
    }

    let body = json_body(response).await;
    assert_eq!(body["user"]["email"], "owner@example.com");
    assert!(body.get("sessionToken").is_none());
    assert!(body.get("csrfToken").is_none());
}

#[tokio::test]
async fn invalid_json_uses_a_stable_error_shape() {
    let app = test_app(CheckStatus::Ok, false).await;
    let response = app
        .oneshot(
            Request::post("/_api/auth/register")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from("{"))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    assert_eq!(json_body(response).await, json!({ "code": "INVALID_JSON" }));
}

#[tokio::test]
async fn password_reset_requests_are_non_enumerating_and_ip_limited() {
    let (app, _, repository) = test_app_with_recovery(CheckStatus::Ok, false).await;
    let peer = "192.0.2.40:43100";
    for index in 0..6 {
        let response = app
            .clone()
            .oneshot(password_reset_request(
                &format!("user{index}@example.com"),
                peer,
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::ACCEPTED);
        assert_eq!(response.headers()[header::CACHE_CONTROL], "no-store");
        assert!(
            to_bytes(response.into_body(), 1_024)
                .await
                .unwrap()
                .is_empty()
        );
    }
    assert_eq!(repository.state.lock().unwrap().created.len(), 5);

    let other_peer = app
        .clone()
        .oneshot(password_reset_request(
            "other@example.com",
            "192.0.2.41:43100",
        ))
        .await
        .unwrap();
    assert_eq!(other_peer.status(), StatusCode::ACCEPTED);
    let invalid = app
        .oneshot(password_reset_request("not-an-email", "192.0.2.42:43100"))
        .await
        .unwrap();
    assert_eq!(invalid.status(), StatusCode::ACCEPTED);
    assert_eq!(repository.state.lock().unwrap().created.len(), 6);
}

#[tokio::test]
async fn password_reset_confirmation_needs_no_session_and_clears_old_cookies() {
    let (app, _, repository) = test_app_with_recovery(CheckStatus::Ok, true).await;
    let token = zipship_auth::OpaqueToken::generate().unwrap();
    let response = app
        .oneshot(password_reset_confirmation(
            token.secret().expose_secret(),
            "192.0.2.50:43100",
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NO_CONTENT);
    assert_eq!(response.headers()[header::CACHE_CONTROL], "no-store");
    let session = response_cookie(&response, "zipship_session").to_ascii_lowercase();
    let csrf = response_cookie(&response, "zipship_csrf").to_ascii_lowercase();
    for cookie in [session, csrf] {
        assert!(cookie.contains("max-age=0"));
        assert!(cookie.contains("secure"));
        assert!(cookie.contains("samesite=strict"));
    }
    assert_eq!(repository.state.lock().unwrap().consumed.len(), 1);
}

#[tokio::test]
async fn password_reset_confirmation_has_a_separate_brute_force_limit() {
    let app = test_app(CheckStatus::Ok, false).await;
    let peer = "192.0.2.60:43100";
    for _ in 0..10 {
        let response = app
            .clone()
            .oneshot(password_reset_confirmation("invalid", peer))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        assert_eq!(
            json_body(response).await,
            json!({ "code": "INVALID_PASSWORD_RESET_TOKEN" })
        );
    }
    let limited = app
        .oneshot(password_reset_confirmation("invalid", peer))
        .await
        .unwrap();
    assert_eq!(limited.status(), StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(
        json_body(limited).await,
        json!({ "code": "ANONYMOUS_RATE_LIMITED" })
    );
}

#[tokio::test]
async fn logout_requires_csrf_and_revokes_the_session() {
    let app = test_app(CheckStatus::Ok, false).await;
    let registered = app.clone().oneshot(register_request()).await.unwrap();
    let session = response_cookie(&registered, "zipship_session");
    let csrf = response_cookie(&registered, "zipship_csrf");
    let cookie_header = format!("{}; {}", cookie_pair(&session), cookie_pair(&csrf));

    let current = app
        .clone()
        .oneshot(
            Request::get("/_api/auth/me")
                .header(header::COOKIE, &cookie_header)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(current.status(), StatusCode::OK);

    let missing_csrf = app
        .clone()
        .oneshot(
            Request::post("/_api/auth/logout")
                .header(header::COOKIE, &cookie_header)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(missing_csrf.status(), StatusCode::FORBIDDEN);
    assert_eq!(
        json_body(missing_csrf).await,
        json!({ "code": "INVALID_CSRF_TOKEN" }),
    );

    let logged_out = app
        .clone()
        .oneshot(
            Request::post("/_api/auth/logout")
                .header(header::COOKIE, &cookie_header)
                .header("x-csrf-token", cookie_value(&csrf))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(logged_out.status(), StatusCode::NO_CONTENT);
    assert!(
        response_cookie(&logged_out, "zipship_session")
            .to_ascii_lowercase()
            .contains("max-age=0"),
    );

    let rejected = app
        .oneshot(
            Request::get("/_api/auth/me")
                .header(header::COOKIE, cookie_header)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(rejected.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(
        json_body(rejected).await,
        json!({ "code": "UNAUTHENTICATED" }),
    );
}

#[tokio::test]
async fn profile_update_requires_csrf_and_refreshes_the_current_user() {
    let app = test_app(CheckStatus::Ok, false).await;
    let registered = app.clone().oneshot(register_request()).await.unwrap();
    let session = response_cookie(&registered, "zipship_session");
    let csrf = response_cookie(&registered, "zipship_csrf");
    let cookie_header = format!("{}; {}", cookie_pair(&session), cookie_pair(&csrf));
    let body = json!({ "displayName": "  Product Owner  " }).to_string();

    let missing_csrf = app
        .clone()
        .oneshot(
            Request::patch("/_api/auth/me")
                .header(header::COOKIE, &cookie_header)
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(body.clone()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(missing_csrf.status(), StatusCode::FORBIDDEN);
    assert_eq!(
        json_body(missing_csrf).await,
        json!({ "code": "INVALID_CSRF_TOKEN" })
    );

    let updated = app
        .clone()
        .oneshot(
            Request::patch("/_api/auth/me")
                .header(header::COOKIE, &cookie_header)
                .header(header::CONTENT_TYPE, "application/json")
                .header("x-csrf-token", cookie_value(&csrf))
                .body(Body::from(body))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(updated.status(), StatusCode::OK);
    assert_eq!(updated.headers()[header::CACHE_CONTROL], "no-store");
    let updated = json_body(updated).await;
    assert_eq!(updated["user"]["displayName"], "Product Owner");
    assert_eq!(updated["user"]["email"], "owner@example.com");

    let current = app
        .clone()
        .oneshot(
            Request::get("/_api/auth/me")
                .header(header::COOKIE, &cookie_header)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(current.status(), StatusCode::OK);
    assert_eq!(
        json_body(current).await["user"]["displayName"],
        "Product Owner"
    );

    let invalid = app
        .oneshot(
            Request::patch("/_api/auth/me")
                .header(header::COOKIE, cookie_header)
                .header(header::CONTENT_TYPE, "application/json")
                .header("x-csrf-token", cookie_value(&csrf))
                .body(Body::from(json!({ "displayName": " " }).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(invalid.status(), StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(
        json_body(invalid).await,
        json!({ "code": "INVALID_DISPLAY_NAME" })
    );
}
