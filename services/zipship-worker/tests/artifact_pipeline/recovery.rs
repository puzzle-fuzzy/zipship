use super::support::{
    cookie_pair, login_request, real_app, recovery_keys, register_request, response_cookie,
    test_pool, with_peer,
};
use axum::{
    body::Body,
    http::{Request, StatusCode, header},
};
use secrecy::ExposeSecret;
use serde_json::json;
use tower::ServiceExt;
use uuid::Uuid;
use zipship_storage::LocalArtifactStore;

#[tokio::test]
#[ignore = "requires an isolated PostgreSQL database"]
async fn resets_a_password_through_the_real_http_and_postgres_pipeline() {
    let pool = test_pool().await;
    zipship_postgres::migrate(&pool).await.unwrap();
    sqlx::query("TRUNCATE TABLE organizations, users, artifacts, jobs CASCADE")
        .execute(&pool)
        .await
        .unwrap();
    let temp = tempfile::tempdir().unwrap();
    let storage = LocalArtifactStore::new(temp.path());
    storage.ensure_layout().await.unwrap();
    let app = real_app(&pool, &storage).await;

    let registered = app.clone().oneshot(register_request()).await.unwrap();
    assert_eq!(registered.status(), StatusCode::CREATED);
    let session = response_cookie(&registered, "zipship_session");
    let csrf = response_cookie(&registered, "zipship_csrf");
    let cookie_header = format!("{}; {}", cookie_pair(&session), cookie_pair(&csrf));

    let requested = app
        .clone()
        .oneshot(with_peer(
            Request::post("/_api/auth/password-resets")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    json!({ "email": "owner@example.com" }).to_string(),
                ))
                .unwrap(),
        ))
        .await
        .unwrap();
    assert_eq!(requested.status(), StatusCode::ACCEPTED);

    let (request_id, key_id, nonce, ciphertext) =
        sqlx::query_as::<_, (Uuid, String, Vec<u8>, Vec<u8>)>(
            r#"
            SELECT aggregate_id, key_id, nonce, ciphertext
            FROM email_outbox
            WHERE kind = 'password_reset' AND state = 'queued'
            "#,
        )
        .fetch_one(&pool)
        .await
        .unwrap();
    let delivery = recovery_keys()
        .open_password_reset(
            request_id,
            &zipship_recovery::SealedEnvelope {
                key_id,
                nonce: nonce.try_into().unwrap(),
                ciphertext,
            },
        )
        .unwrap();
    let confirmed = app
        .clone()
        .oneshot(with_peer(
            Request::post("/_api/auth/password-resets/confirm")
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, &cookie_header)
                .body(Body::from(
                    json!({
                        "token": delivery.token.expose_secret(),
                        "password": "replacement correct horse battery staple"
                    })
                    .to_string(),
                ))
                .unwrap(),
        ))
        .await
        .unwrap();
    assert_eq!(confirmed.status(), StatusCode::NO_CONTENT);
    assert!(
        confirmed
            .headers()
            .get_all(header::SET_COOKIE)
            .iter()
            .filter_map(|value| value.to_str().ok())
            .filter(|value| value.to_ascii_lowercase().contains("max-age=0"))
            .count()
            >= 2
    );

    let old_session = app
        .clone()
        .oneshot(
            Request::get("/_api/auth/me")
                .header(header::COOKIE, cookie_pair(&session))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(old_session.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(
        app.clone()
            .oneshot(login_request("correct horse battery staple"))
            .await
            .unwrap()
            .status(),
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        app.oneshot(login_request("replacement correct horse battery staple"))
            .await
            .unwrap()
            .status(),
        StatusCode::OK
    );

    let reset_state =
        sqlx::query_scalar::<_, String>("SELECT state FROM password_reset_requests WHERE id = $1")
            .bind(request_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    let outbox = sqlx::query_as::<_, (String, Option<Vec<u8>>)>(
        "SELECT state, ciphertext FROM email_outbox WHERE aggregate_id = $1",
    )
    .bind(request_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(reset_state, "consumed");
    assert_eq!(outbox, ("cancelled".to_owned(), None));
}
