use super::*;

#[tokio::test]
async fn upload_routes_stream_exact_archives_and_finalize_idempotently() {
    let (app, storage) = test_app_with_storage(CheckStatus::Ok, false).await;
    let registered = app.clone().oneshot(register_request()).await.unwrap();
    let session = response_cookie(&registered, "zipship_session");
    let csrf = response_cookie(&registered, "zipship_csrf");
    let cookie_header = format!("{}; {}", cookie_pair(&session), cookie_pair(&csrf));

    let project_path = format!("/_api/organizations/{TEST_ORGANIZATION_ID}/projects");
    let created_project = app
        .clone()
        .oneshot(
            Request::post(project_path)
                .header(header::COOKIE, &cookie_header)
                .header(header::CONTENT_TYPE, "application/json")
                .header("x-csrf-token", cookie_value(&csrf))
                .body(Body::from(
                    json!({
                        "name": "Marketing Site",
                        "slug": "marketing-site"
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    let project = json_body(created_project).await;
    let project_id = project["project"]["id"].as_str().unwrap();

    let archive = b"PK\x03\x04streamed frontend archive".to_vec();
    let created_upload = app
        .clone()
        .oneshot(
            Request::post(format!("/_api/projects/{project_id}/uploads"))
                .header(header::COOKIE, &cookie_header)
                .header(header::CONTENT_TYPE, "application/json")
                .header("x-csrf-token", cookie_value(&csrf))
                .body(Body::from(
                    json!({
                        "filename": "frontend.zip",
                        "sizeBytes": archive.len()
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(created_upload.status(), StatusCode::CREATED);
    let created_upload = json_body(created_upload).await;
    let upload_id = created_upload["upload"]["id"].as_str().unwrap();
    let upload_uuid = Uuid::parse_str(upload_id).unwrap();
    let content_path = format!("/_api/uploads/{upload_id}/content");

    let missing_length = app
        .clone()
        .oneshot(
            Request::put(&content_path)
                .header(header::COOKIE, &cookie_header)
                .header(header::CONTENT_TYPE, "application/zip")
                .header("x-csrf-token", cookie_value(&csrf))
                .body(Body::from(archive.clone()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(missing_length.status(), StatusCode::LENGTH_REQUIRED);
    assert_eq!(
        json_body(missing_length).await,
        json!({ "code": "CONTENT_LENGTH_REQUIRED" }),
    );

    let interrupted = app
        .clone()
        .oneshot(
            Request::put(&content_path)
                .header(header::COOKIE, &cookie_header)
                .header(header::CONTENT_TYPE, "application/zip")
                .header(header::CONTENT_LENGTH, archive.len())
                .header("x-csrf-token", cookie_value(&csrf))
                .body(Body::from(archive[..archive.len() - 1].to_vec()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(interrupted.status(), StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(
        json_body(interrupted).await,
        json!({ "code": "UPLOAD_SIZE_MISMATCH" }),
    );
    assert!(
        !tokio::fs::try_exists(storage.upload_archive_path(upload_uuid))
            .await
            .unwrap(),
    );

    let uploaded = app
        .clone()
        .oneshot(
            Request::put(&content_path)
                .header(header::COOKIE, &cookie_header)
                .header(header::CONTENT_TYPE, "application/zip")
                .header(header::CONTENT_LENGTH, archive.len())
                .header("x-csrf-token", cookie_value(&csrf))
                .body(Body::from(archive.clone()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(uploaded.status(), StatusCode::OK);
    assert_eq!(json_body(uploaded).await["upload"]["status"], "uploaded");
    assert_eq!(
        tokio::fs::read(storage.upload_archive_path(upload_uuid))
            .await
            .unwrap(),
        archive,
    );

    let complete_path = format!("/_api/uploads/{upload_id}/complete");
    let first = app
        .clone()
        .oneshot(
            Request::post(&complete_path)
                .header(header::COOKIE, &cookie_header)
                .header("x-csrf-token", cookie_value(&csrf))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(first.status(), StatusCode::ACCEPTED);
    let first = json_body(first).await;
    assert_eq!(first["upload"]["status"], "processing");

    let second = app
        .clone()
        .oneshot(
            Request::post(&complete_path)
                .header(header::COOKIE, &cookie_header)
                .header("x-csrf-token", cookie_value(&csrf))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(second.status(), StatusCode::ACCEPTED);
    let second = json_body(second).await;
    assert_eq!(first["releaseId"], second["releaseId"]);
    assert_eq!(first["jobId"], second["jobId"]);
}
