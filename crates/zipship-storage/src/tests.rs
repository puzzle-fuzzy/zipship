use super::*;
use tempfile::tempdir;

fn digest() -> ArtifactDigest {
    ArtifactDigest::parse("0123456789abcdef".repeat(4)).unwrap()
}

#[tokio::test]
async fn creates_the_storage_layout() {
    let temp = tempdir().unwrap();
    let storage = LocalArtifactStore::new(temp.path());
    storage.ensure_layout().await.unwrap();
    storage.check_health().await.unwrap();
}

#[tokio::test]
async fn maps_full_hashes_to_sharded_blob_paths() {
    let temp = tempdir().unwrap();
    let storage = LocalArtifactStore::new(temp.path());
    let path = storage.artifact_path(&digest());
    assert!(path.ends_with(Path::new(
        "blobs/sha256/01/23/0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    )));
    assert_eq!(
        LocalArtifactStore::artifact_storage_key(&digest()),
        "blobs/sha256/01/23/0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    );
}

#[tokio::test]
async fn atomically_commits_a_staging_directory_without_overwriting() {
    let temp = tempdir().unwrap();
    let storage = LocalArtifactStore::new(temp.path());
    storage.ensure_layout().await.unwrap();

    let first = storage.upload_staging_path(Uuid::new_v4()).join("expanded");
    fs::create_dir_all(&first).await.unwrap();
    fs::write(first.join("index.html"), "first").await.unwrap();
    assert_eq!(
        storage
            .commit_artifact_directory(&first, &digest())
            .await
            .unwrap(),
        CommitOutcome::Created,
    );

    let duplicate = storage.upload_staging_path(Uuid::new_v4()).join("expanded");
    fs::create_dir_all(&duplicate).await.unwrap();
    fs::write(duplicate.join("index.html"), "second")
        .await
        .unwrap();
    assert_eq!(
        storage
            .commit_artifact_directory(&duplicate, &digest())
            .await
            .unwrap(),
        CommitOutcome::AlreadyExists,
    );

    assert_eq!(
        fs::read_to_string(storage.artifact_path(&digest()).join("index.html"))
            .await
            .unwrap(),
        "first",
    );
}

#[tokio::test]
async fn refuses_to_commit_a_directory_outside_staging() {
    let temp = tempdir().unwrap();
    let storage = LocalArtifactStore::new(temp.path().join("store"));
    storage.ensure_layout().await.unwrap();
    let outside = temp.path().join("outside");
    fs::create_dir_all(&outside).await.unwrap();

    assert!(matches!(
        storage.commit_artifact_directory(&outside, &digest()).await,
        Err(StorageError::InvalidStagingPath),
    ));
}

#[tokio::test]
async fn streams_exact_uploads_to_a_stable_archive_path() {
    let temp = tempdir().unwrap();
    let storage = LocalArtifactStore::new(temp.path());
    storage.ensure_layout().await.unwrap();
    let upload_id = Uuid::new_v4();
    let contents = b"PK\x03\x04zip payload".to_vec();

    let result = storage
        .write_upload_stream(
            upload_id,
            Uuid::new_v4(),
            std::io::Cursor::new(contents.clone()),
            contents.len() as u64,
        )
        .await
        .unwrap();
    assert_eq!(result.path, storage.upload_archive_path(upload_id));
    assert_eq!(result.bytes_written, contents.len() as u64);
    assert_eq!(fs::read(result.path).await.unwrap(), contents);
    assert_eq!(
        LocalArtifactStore::upload_staging_key(upload_id),
        format!("uploads/{upload_id}/archive.zip"),
    );
}

#[tokio::test]
async fn removes_partial_files_when_the_body_is_short_or_oversized() {
    let temp = tempdir().unwrap();
    let storage = LocalArtifactStore::new(temp.path());
    storage.ensure_layout().await.unwrap();

    for (contents, expected) in [(b"short".as_slice(), 10_u64), (b"too long".as_slice(), 3)] {
        let upload_id = Uuid::new_v4();
        let result = storage
            .write_upload_stream(
                upload_id,
                Uuid::new_v4(),
                std::io::Cursor::new(contents),
                expected,
            )
            .await;
        assert!(matches!(
            result,
            Err(StorageError::UploadSizeMismatch { .. }) | Err(StorageError::UploadTooLarge { .. })
        ));
        assert!(
            !fs::try_exists(storage.upload_archive_path(upload_id))
                .await
                .unwrap()
        );
        let mut entries = fs::read_dir(storage.upload_staging_path(upload_id))
            .await
            .unwrap();
        assert!(entries.next_entry().await.unwrap().is_none());
    }
}

#[tokio::test]
async fn a_retry_replaces_an_unfinalized_archive() {
    let temp = tempdir().unwrap();
    let storage = LocalArtifactStore::new(temp.path());
    storage.ensure_layout().await.unwrap();
    let upload_id = Uuid::new_v4();

    for contents in [b"first".as_slice(), b"retry".as_slice()] {
        storage
            .write_upload_stream(
                upload_id,
                Uuid::new_v4(),
                std::io::Cursor::new(contents),
                contents.len() as u64,
            )
            .await
            .unwrap();
    }
    assert_eq!(
        fs::read(storage.upload_archive_path(upload_id))
            .await
            .unwrap(),
        b"retry",
    );
}

#[tokio::test]
async fn opens_only_regular_files_beneath_an_artifact_root() {
    let temp = tempdir().unwrap();
    let storage = LocalArtifactStore::new(temp.path());
    storage.ensure_layout().await.unwrap();
    let root = storage.artifact_path(&digest());
    fs::create_dir_all(root.join("assets")).await.unwrap();
    fs::write(root.join("assets/app.js"), b"ready")
        .await
        .unwrap();

    let mut file = storage
        .open_artifact_file(&digest(), "assets/app.js")
        .await
        .unwrap();
    let mut contents = String::new();
    file.read_to_string(&mut contents).await.unwrap();
    assert_eq!(contents, "ready");
    assert!(matches!(
        storage.open_artifact_file(&digest(), "../secret").await,
        Err(StorageError::InvalidArtifactPath)
    ));
    assert!(matches!(
        storage.open_artifact_file(&digest(), "assets").await,
        Err(StorageError::InvalidArtifactFile)
    ));
}

#[cfg(unix)]
#[tokio::test]
async fn refuses_symlinks_inside_artifact_directories() {
    use std::os::unix::fs::symlink;

    let temp = tempdir().unwrap();
    let storage = LocalArtifactStore::new(temp.path());
    storage.ensure_layout().await.unwrap();
    let root = storage.artifact_path(&digest());
    fs::create_dir_all(&root).await.unwrap();
    let outside = temp.path().join("secret.txt");
    fs::write(&outside, b"secret").await.unwrap();
    symlink(&outside, root.join("index.html")).unwrap();

    assert!(matches!(
        storage.open_artifact_file(&digest(), "index.html").await,
        Err(StorageError::InvalidArtifactFile)
    ));
}
