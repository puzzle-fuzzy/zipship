use super::*;

#[test]
fn reports_static_artifact_facts_and_complete_seo_metadata() {
    let temp = tempdir().unwrap();
    let archive = temp.path().join("site.zip");
    write_zip(
        &archive,
        &[
            (
                "dist/index.html",
                br#"<!doctype html>
                <html lang="en">
                  <head>
                    <meta name="viewport" content="width=device-width, initial-scale=1">
                    <title>ZipShip Demo</title>
                    <meta content="A deployable demo." name="description">
                    <link href="https://example.com/" rel="canonical">
                    <meta content="ZipShip Demo" property="og:title">
                    <meta content="A deployable demo." property="og:description">
                    <link href="./favicon.ico" rel="icon">
                  </head>
                  <body><script type="module" src="./assets/app.js"></script></body>
                </html>"#,
            ),
            ("dist/assets/app.js", b"console.log('ready')"),
            ("dist/assets/app.css", b"body { color: #111; }"),
            ("dist/favicon.ico", b"ico"),
        ],
    );
    let extracted = extract_artifact(
        &archive,
        &temp.path().join("expanded"),
        ArtifactLimits::default(),
    )
    .unwrap();

    let report = detect_artifact(&extracted.root, &extracted.manifest).unwrap();

    assert_eq!(report.report_version, 1);
    assert_eq!(report.manifest_version, 1);
    assert_eq!(report.entry_point, "index.html");
    assert_eq!(report.level, ArtifactReportLevel::Pass);
    assert!(report.items.is_empty());
    assert_eq!(report.insights.entrypoint, "index.html");
    assert_eq!(report.insights.assets.total_files, 4);
    assert_eq!(report.insights.assets.total_size, extracted.total_size);
    assert_eq!(report.insights.assets.by_type.html.count, 1);
    assert_eq!(report.insights.assets.by_type.javascript.count, 1);
    assert_eq!(report.insights.assets.by_type.css.count, 1);
    assert_eq!(report.insights.assets.by_type.images.count, 1);
    assert_eq!(report.insights.html.title.as_deref(), Some("ZipShip Demo"));
    assert_eq!(
        report.insights.html.description.as_deref(),
        Some("A deployable demo.")
    );
    assert_eq!(report.insights.html.lang.as_deref(), Some("en"));
    assert!(report.insights.html.has_viewport);
    assert!(report.insights.html.has_canonical);
    assert!(report.insights.html.has_open_graph);
    assert!(report.insights.html.has_favicon);
    assert_eq!(report.insights.seo.score, 100);
    assert!(
        report
            .insights
            .seo
            .checks
            .iter()
            .all(|check| check.status == SeoCheckStatus::Pass)
    );
}

#[test]
fn reports_deployment_and_sensitive_file_risks_without_claiming_runtime_checks() {
    let temp = tempdir().unwrap();
    let archive = temp.path().join("risky.zip");
    write_zip(
        &archive,
        &[
            (
                "index.html",
                br#"<html><head><title></title></head><body><script src="/assets/app.js"></script></body></html>"#,
            ),
            ("assets/app.js", b"console.log('ready')"),
            ("assets/app.js.map", b"{}"),
            ("service-worker.js", b"self.addEventListener('fetch', () => {})"),
            (".env.production", b"PUBLIC_VALUE=should-not-ship"),
            ("server.pem", b"not-a-real-key"),
            (".git/config", b"[core]"),
        ],
    );
    let extracted = extract_artifact(
        &archive,
        &temp.path().join("expanded"),
        ArtifactLimits::default(),
    )
    .unwrap();

    let report = detect_artifact(&extracted.root, &extracted.manifest).unwrap();
    let codes = report
        .items
        .iter()
        .map(|item| item.code.as_str())
        .collect::<Vec<_>>();

    assert_eq!(report.level, ArtifactReportLevel::Failed);
    assert!(codes.contains(&"ENV_FILE_DETECTED"));
    assert!(codes.contains(&"SECRET_FILE_DETECTED"));
    assert!(codes.contains(&"GIT_DIR_DETECTED"));
    assert!(codes.contains(&"SOURCE_MAP_DETECTED"));
    assert!(codes.contains(&"SERVICE_WORKER_DETECTED"));
    assert!(codes.contains(&"ROOT_ASSET_PATH_DETECTED"));
    assert_eq!(report.insights.seo.score, 0);
    assert!(
        report
            .insights
            .seo
            .checks
            .iter()
            .all(|check| check.status == SeoCheckStatus::Warning)
    );

    let value = serde_json::to_value(report).unwrap();
    assert_eq!(value["reportVersion"], 1);
    assert_eq!(value["level"], "failed");
    assert!(value.get("runtime").is_none());
}
