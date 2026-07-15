use super::*;

#[tokio::test]
async fn member_mutations_require_csrf_and_preserve_the_last_owner() {
    let app = test_app(CheckStatus::Ok, false).await;
    let registered = app.clone().oneshot(register_request()).await.unwrap();
    let session = response_cookie(&registered, "zipship_session");
    let csrf = response_cookie(&registered, "zipship_csrf");
    let actor_id = json_body(registered).await["user"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let cookie_header = format!("{}; {}", cookie_pair(&session), cookie_pair(&csrf));
    let target_user_id = Uuid::from_u128(2);
    let path = format!("/_api/organizations/{TEST_ORGANIZATION_ID}/members/{target_user_id}");
    let body = json!({ "role": "admin" }).to_string();

    let missing_csrf = app
        .clone()
        .oneshot(
            Request::patch(&path)
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
            Request::patch(&path)
                .header(header::COOKIE, &cookie_header)
                .header(header::CONTENT_TYPE, "application/json")
                .header("x-csrf-token", cookie_value(&csrf))
                .body(Body::from(body))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(updated.status(), StatusCode::OK);
    let updated = json_body(updated).await;
    assert_eq!(updated["member"]["userId"], target_user_id.to_string());
    assert_eq!(updated["member"]["role"], "admin");

    let listed = app
        .clone()
        .oneshot(
            Request::get(format!(
                "/_api/organizations/{TEST_ORGANIZATION_ID}/members"
            ))
            .header(header::COOKIE, &cookie_header)
            .body(Body::empty())
            .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(listed.status(), StatusCode::OK);
    assert_eq!(json_body(listed).await["members"][0]["role"], "owner");

    let missing_remove_csrf = app
        .clone()
        .oneshot(
            Request::delete(&path)
                .header(header::COOKIE, &cookie_header)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(missing_remove_csrf.status(), StatusCode::FORBIDDEN);
    assert_eq!(
        json_body(missing_remove_csrf).await,
        json!({ "code": "INVALID_CSRF_TOKEN" })
    );

    let invalid_target = app
        .clone()
        .oneshot(
            Request::delete(format!(
                "/_api/organizations/{TEST_ORGANIZATION_ID}/members/not-a-uuid"
            ))
            .header(header::COOKIE, &cookie_header)
            .header("x-csrf-token", cookie_value(&csrf))
            .body(Body::empty())
            .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(invalid_target.status(), StatusCode::BAD_REQUEST);
    assert_eq!(
        json_body(invalid_target).await,
        json!({ "code": "INVALID_PATH_PARAMETER" })
    );

    let removed = app
        .clone()
        .oneshot(
            Request::delete(&path)
                .header(header::COOKIE, &cookie_header)
                .header("x-csrf-token", cookie_value(&csrf))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(removed.status(), StatusCode::NO_CONTENT);
    assert_eq!(removed.headers()[header::CACHE_CONTROL], "no-store");
    assert!(
        to_bytes(removed.into_body(), usize::MAX)
            .await
            .unwrap()
            .is_empty()
    );

    let last_owner = app
        .clone()
        .oneshot(
            Request::patch(format!(
                "/_api/organizations/{TEST_ORGANIZATION_ID}/members/{actor_id}"
            ))
            .header(header::COOKIE, &cookie_header)
            .header(header::CONTENT_TYPE, "application/json")
            .header("x-csrf-token", cookie_value(&csrf))
            .body(Body::from(json!({ "role": "viewer" }).to_string()))
            .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(last_owner.status(), StatusCode::CONFLICT);
    assert_eq!(json_body(last_owner).await, json!({ "code": "LAST_OWNER" }));

    let remove_last_owner = app
        .oneshot(
            Request::delete(format!(
                "/_api/organizations/{TEST_ORGANIZATION_ID}/members/{actor_id}"
            ))
            .header(header::COOKIE, cookie_header)
            .header("x-csrf-token", cookie_value(&csrf))
            .body(Body::empty())
            .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(remove_last_owner.status(), StatusCode::CONFLICT);
    assert_eq!(
        json_body(remove_last_owner).await,
        json!({ "code": "LAST_OWNER" })
    );
}

#[tokio::test]
async fn invitation_routes_issue_manage_and_accept_one_time_tokens() {
    let app = test_app(CheckStatus::Ok, false).await;
    let registered = app.clone().oneshot(register_request()).await.unwrap();
    let session = response_cookie(&registered, "zipship_session");
    let csrf = response_cookie(&registered, "zipship_csrf");
    let cookie_header = format!("{}; {}", cookie_pair(&session), cookie_pair(&csrf));
    let collection_path = format!("/_api/organizations/{TEST_ORGANIZATION_ID}/invitations");
    let invitation_body = json!({
        "email": "owner@example.com",
        "role": "developer"
    })
    .to_string();

    let missing_csrf = app
        .clone()
        .oneshot(
            Request::post(&collection_path)
                .header(header::COOKIE, &cookie_header)
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(invitation_body.clone()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(missing_csrf.status(), StatusCode::FORBIDDEN);

    let invalid_email = app
        .clone()
        .oneshot(
            Request::post(&collection_path)
                .header(header::COOKIE, &cookie_header)
                .header(header::CONTENT_TYPE, "application/json")
                .header("x-csrf-token", cookie_value(&csrf))
                .body(Body::from(
                    json!({ "email": "invalid", "role": "viewer" }).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(invalid_email.status(), StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(
        json_body(invalid_email).await,
        json!({ "code": "INVALID_EMAIL" })
    );

    let created = app
        .clone()
        .oneshot(
            Request::post(&collection_path)
                .header(header::COOKIE, &cookie_header)
                .header(header::CONTENT_TYPE, "application/json")
                .header("x-csrf-token", cookie_value(&csrf))
                .body(Body::from(invitation_body))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(created.status(), StatusCode::CREATED);
    let created = json_body(created).await;
    let token = created["acceptToken"].as_str().unwrap().to_owned();
    assert_eq!(token.len(), 43);
    assert_eq!(created["invitation"]["state"], "pending");
    assert!(created["invitation"].get("acceptToken").is_none());

    let listed = app
        .clone()
        .oneshot(
            Request::get(&collection_path)
                .header(header::COOKIE, &cookie_header)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(listed.status(), StatusCode::OK);
    let listed = json_body(listed).await;
    assert_eq!(listed["invitations"].as_array().unwrap().len(), 1);
    assert!(listed["invitations"][0].get("acceptToken").is_none());

    let missing_accept_csrf = app
        .clone()
        .oneshot(
            Request::post("/_api/invitations/accept")
                .header(header::COOKIE, &cookie_header)
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(json!({ "token": token }).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(missing_accept_csrf.status(), StatusCode::FORBIDDEN);

    for replayed in [false, true] {
        let accepted = app
            .clone()
            .oneshot(
                Request::post("/_api/invitations/accept")
                    .header(header::COOKIE, &cookie_header)
                    .header(header::CONTENT_TYPE, "application/json")
                    .header("x-csrf-token", cookie_value(&csrf))
                    .body(Body::from(json!({ "token": token }).to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(accepted.status(), StatusCode::OK);
        assert_eq!(json_body(accepted).await["replayed"], replayed);
    }

    let second_created = app
        .clone()
        .oneshot(
            Request::post(&collection_path)
                .header(header::COOKIE, &cookie_header)
                .header(header::CONTENT_TYPE, "application/json")
                .header("x-csrf-token", cookie_value(&csrf))
                .body(Body::from(
                    json!({ "email": "other@example.com", "role": "viewer" }).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    let second_created = json_body(second_created).await;
    let second_id = second_created["invitation"]["id"].as_str().unwrap();
    let second_token = second_created["acceptToken"].as_str().unwrap();

    let wrong_recipient = app
        .clone()
        .oneshot(
            Request::post("/_api/invitations/accept")
                .header(header::COOKIE, &cookie_header)
                .header(header::CONTENT_TYPE, "application/json")
                .header("x-csrf-token", cookie_value(&csrf))
                .body(Body::from(json!({ "token": second_token }).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(wrong_recipient.status(), StatusCode::FORBIDDEN);
    assert_eq!(
        json_body(wrong_recipient).await,
        json!({ "code": "INVITATION_WRONG_RECIPIENT" })
    );

    let revoked = app
        .clone()
        .oneshot(
            Request::delete(format!("{collection_path}/{second_id}"))
                .header(header::COOKIE, &cookie_header)
                .header("x-csrf-token", cookie_value(&csrf))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(revoked.status(), StatusCode::NO_CONTENT);

    let revoked_token = app
        .oneshot(
            Request::post("/_api/invitations/accept")
                .header(header::COOKIE, cookie_header)
                .header(header::CONTENT_TYPE, "application/json")
                .header("x-csrf-token", cookie_value(&csrf))
                .body(Body::from(json!({ "token": second_token }).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(revoked_token.status(), StatusCode::NOT_FOUND);
    assert_eq!(
        json_body(revoked_token).await,
        json!({ "code": "INVITATION_NOT_FOUND" })
    );
}
