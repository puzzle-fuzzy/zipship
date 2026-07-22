use std::{
    collections::HashMap,
    fs::File,
    io::{Read, Take},
    path::Path,
    sync::LazyLock,
};

use regex::Regex;

use crate::{
    ArtifactAssetBreakdown, ArtifactAssetSummary, ArtifactAssetTypeSummary, ArtifactDetectReport,
    ArtifactError, ArtifactFileSummary, ArtifactHtmlMetadata, ArtifactInsights, ArtifactIssueLevel,
    ArtifactManifest, ArtifactReportIssue, ArtifactReportLevel, ArtifactSeoCheck,
    ArtifactSeoSummary, SeoCheckStatus,
};

const REPORT_VERSION: u32 = 1;
const MAX_HTML_ANALYSIS_BYTES: u64 = 512 * 1_024;
const MAX_CSS_FILE_ANALYSIS_BYTES: u64 = 1_024 * 1_024;
const MAX_TOTAL_CSS_ANALYSIS_BYTES: u64 = 4 * 1_024 * 1_024;

static TITLE_PATTERN: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?is)<title\b[^>]*>(.*?)</title\s*>").expect("title regex is valid")
});
static META_PATTERN: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?is)<meta\b[^>]*>").expect("meta regex is valid"));
static LINK_PATTERN: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?is)<link\b[^>]*>").expect("link regex is valid"));
static HTML_PATTERN: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?is)<html\b[^>]*>").expect("html regex is valid"));
static ATTRIBUTE_PATTERN: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"(?is)([a-z_:][-a-z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))"#)
        .expect("HTML attribute regex is valid")
});
static CSS_ROOT_ASSET_PATTERN: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"(?i)url\(\s*["']?/assets/"#).expect("CSS URL regex is valid"));

pub fn detect_artifact(
    root: &Path,
    manifest: &ArtifactManifest,
) -> Result<ArtifactDetectReport, ArtifactError> {
    validate_manifest_paths(manifest)?;
    let index_entry = manifest
        .files
        .iter()
        .find(|entry| entry.path == "index.html")
        .ok_or(ArtifactError::MissingIndex)?;
    let html = read_text_prefix(
        &root.join(&index_entry.path),
        index_entry.size.min(MAX_HTML_ANALYSIS_BYTES),
    )?;
    let mut items = scan_file_risks(manifest);
    scan_html_references(&html, manifest, &mut items);
    scan_css_references(root, manifest, &mut items)?;

    let html_metadata = analyze_html(&html, manifest);
    let seo = analyze_seo(&html_metadata);
    let assets = summarize_assets(manifest);
    let level = if items
        .iter()
        .any(|item| item.level == ArtifactIssueLevel::Failed)
    {
        ArtifactReportLevel::Failed
    } else if items
        .iter()
        .any(|item| item.level == ArtifactIssueLevel::Warning)
        || seo
            .checks
            .iter()
            .any(|check| check.status == SeoCheckStatus::Warning)
    {
        ArtifactReportLevel::Warning
    } else {
        ArtifactReportLevel::Pass
    };

    Ok(ArtifactDetectReport {
        report_version: REPORT_VERSION,
        manifest_version: manifest.version,
        entry_point: "index.html".to_owned(),
        level,
        items,
        insights: ArtifactInsights {
            entrypoint: "index.html".to_owned(),
            assets,
            html: html_metadata,
            seo,
        },
    })
}

fn validate_manifest_paths(manifest: &ArtifactManifest) -> Result<(), ArtifactError> {
    if manifest.files.iter().any(|entry| {
        entry.path.is_empty()
            || entry.path.starts_with('/')
            || entry.path.contains('\\')
            || entry
                .path
                .split('/')
                .any(|component| component.is_empty() || matches!(component, "." | ".."))
    }) {
        return Err(ArtifactError::UnsafePath);
    }
    Ok(())
}

fn scan_file_risks(manifest: &ArtifactManifest) -> Vec<ArtifactReportIssue> {
    let mut items = Vec::new();
    for entry in &manifest.files {
        let path = entry.path.to_ascii_lowercase();
        let name = path.rsplit('/').next().unwrap_or(path.as_str());
        if name == "service-worker.js" || name == "sw.js" {
            push_issue_once(
                &mut items,
                ArtifactIssueLevel::Warning,
                "SERVICE_WORKER_DETECTED",
            );
        }
        if path.ends_with(".map") {
            push_issue_once(
                &mut items,
                ArtifactIssueLevel::Warning,
                "SOURCE_MAP_DETECTED",
            );
        }
        if name == ".env" || name.starts_with(".env.") {
            push_issue_once(&mut items, ArtifactIssueLevel::Failed, "ENV_FILE_DETECTED");
        }
        if is_secret_filename(name) {
            push_issue_once(
                &mut items,
                ArtifactIssueLevel::Failed,
                "SECRET_FILE_DETECTED",
            );
        }
        if path.split('/').any(|component| component == ".git") {
            push_issue_once(&mut items, ArtifactIssueLevel::Failed, "GIT_DIR_DETECTED");
        }
    }
    items
}

fn is_secret_filename(name: &str) -> bool {
    matches!(name, "id_rsa" | "id_dsa" | "id_ecdsa" | "id_ed25519")
        || [".pem", ".key", ".cert", ".p12", ".pfx", ".pkcs12"]
            .iter()
            .any(|extension| name.ends_with(extension))
}

fn scan_html_references(
    html: &str,
    manifest: &ArtifactManifest,
    items: &mut Vec<ArtifactReportIssue>,
) {
    let mut references_assets = false;
    for captures in ATTRIBUTE_PATTERN.captures_iter(html) {
        let Some(name) = captures.get(1).map(|value| value.as_str()) else {
            continue;
        };
        if !matches!(
            name.to_ascii_lowercase().as_str(),
            "src" | "href" | "poster" | "data-src"
        ) {
            continue;
        }
        let Some(value) = attribute_value(&captures) else {
            continue;
        };
        let value = value.trim();
        references_assets |= value.starts_with("./assets/") || value.starts_with("assets/");
        if value.starts_with("/assets/") {
            push_issue_once(
                items,
                ArtifactIssueLevel::Warning,
                "ROOT_ASSET_PATH_DETECTED",
            );
        } else if is_reserved_platform_reference(value) {
            push_issue_once(
                items,
                ArtifactIssueLevel::Warning,
                "RESERVED_PLATFORM_PATH_REFERENCED",
            );
        } else if value.starts_with('/') && !value.starts_with("//") {
            push_issue_once(
                items,
                ArtifactIssueLevel::Warning,
                "ROOT_PATH_REFERENCE_DETECTED",
            );
        }
    }
    if references_assets
        && !manifest
            .files
            .iter()
            .any(|entry| entry.path.starts_with("assets/"))
    {
        push_issue_once(
            items,
            ArtifactIssueLevel::Warning,
            "REFERENCED_ASSETS_DIR_MISSING",
        );
    }
}

fn is_reserved_platform_reference(value: &str) -> bool {
    ["/_api", "/_sites", "/_health"].iter().any(|prefix| {
        value == *prefix
            || value
                .strip_prefix(prefix)
                .is_some_and(|suffix| suffix.starts_with(['/', '?', '#']))
    })
}

fn scan_css_references(
    root: &Path,
    manifest: &ArtifactManifest,
    items: &mut Vec<ArtifactReportIssue>,
) -> Result<(), ArtifactError> {
    let mut remaining = MAX_TOTAL_CSS_ANALYSIS_BYTES;
    for entry in manifest
        .files
        .iter()
        .filter(|entry| entry.path.to_ascii_lowercase().ends_with(".css"))
    {
        if remaining == 0 {
            break;
        }
        let budget = entry.size.min(MAX_CSS_FILE_ANALYSIS_BYTES).min(remaining);
        let css = read_text_prefix(&root.join(&entry.path), budget)?;
        remaining -= budget;
        if CSS_ROOT_ASSET_PATTERN.is_match(&css) {
            push_issue_once(
                items,
                ArtifactIssueLevel::Warning,
                "ROOT_ASSET_PATH_DETECTED",
            );
        }
    }
    Ok(())
}

fn analyze_html(html: &str, manifest: &ArtifactManifest) -> ArtifactHtmlMetadata {
    let title = TITLE_PATTERN
        .captures(html)
        .and_then(|captures| captures.get(1))
        .and_then(|value| normalize_text(value.as_str()));
    let html_attributes = HTML_PATTERN
        .find(html)
        .map(|tag| attributes(tag.as_str()))
        .unwrap_or_default();
    let mut description = None;
    let mut has_viewport = false;
    let mut has_open_graph_title = false;
    let mut has_open_graph_description = false;
    let mut has_twitter_card = false;
    for tag in META_PATTERN.find_iter(html) {
        let attributes = attributes(tag.as_str());
        let name = attributes
            .get("name")
            .map(|value| value.to_ascii_lowercase());
        let property = attributes
            .get("property")
            .map(|value| value.to_ascii_lowercase());
        if description.is_none() && name.as_deref() == Some("description") {
            description = attributes
                .get("content")
                .and_then(|value| normalize_text(value));
        }
        has_viewport |= name.as_deref() == Some("viewport")
            && attributes
                .get("content")
                .and_then(|value| normalize_text(value))
                .is_some();
        has_twitter_card |= name
            .as_deref()
            .is_some_and(|value| value.starts_with("twitter:"));
        has_open_graph_title |= property.as_deref() == Some("og:title")
            && attributes
                .get("content")
                .and_then(|value| normalize_text(value))
                .is_some();
        has_open_graph_description |= property.as_deref() == Some("og:description")
            && attributes
                .get("content")
                .and_then(|value| normalize_text(value))
                .is_some();
    }
    let mut has_canonical = false;
    let mut has_favicon = manifest
        .files
        .iter()
        .any(|entry| entry.path.eq_ignore_ascii_case("favicon.ico"));
    for tag in LINK_PATTERN.find_iter(html) {
        let attributes = attributes(tag.as_str());
        let relations = attributes
            .get("rel")
            .map(|value| value.split_ascii_whitespace().collect::<Vec<_>>())
            .unwrap_or_default();
        let has_href = attributes
            .get("href")
            .and_then(|value| normalize_text(value))
            .is_some();
        has_canonical |= has_href
            && relations
                .iter()
                .any(|relation| relation.eq_ignore_ascii_case("canonical"));
        has_favicon |= has_href
            && relations
                .iter()
                .any(|relation| relation.eq_ignore_ascii_case("icon"));
    }

    ArtifactHtmlMetadata {
        title,
        description,
        has_viewport,
        has_canonical,
        has_open_graph: has_open_graph_title && has_open_graph_description,
        has_twitter_card,
        has_favicon,
        lang: html_attributes
            .get("lang")
            .and_then(|value| normalize_text(value)),
    }
}

fn attributes(tag: &str) -> HashMap<String, String> {
    ATTRIBUTE_PATTERN
        .captures_iter(tag)
        .filter_map(|captures| {
            let name = captures.get(1)?.as_str().to_ascii_lowercase();
            let value = attribute_value(&captures)?.to_owned();
            Some((name, value))
        })
        .collect()
}

fn attribute_value<'a>(captures: &'a regex::Captures<'_>) -> Option<&'a str> {
    captures
        .get(2)
        .or_else(|| captures.get(3))
        .or_else(|| captures.get(4))
        .map(|value| value.as_str())
}

fn normalize_text(value: &str) -> Option<String> {
    let normalized = value.split_whitespace().collect::<Vec<_>>().join(" ");
    (!normalized.is_empty()).then_some(normalized)
}

fn analyze_seo(html: &ArtifactHtmlMetadata) -> ArtifactSeoSummary {
    let checks = vec![
        seo_check(
            html.title.is_some(),
            "SEO_TITLE_PRESENT",
            "SEO_TITLE_MISSING",
        ),
        seo_check(
            html.description.is_some(),
            "SEO_DESCRIPTION_PRESENT",
            "SEO_DESCRIPTION_MISSING",
        ),
        seo_check(
            html.has_viewport,
            "SEO_VIEWPORT_PRESENT",
            "SEO_VIEWPORT_MISSING",
        ),
        seo_check(
            html.has_canonical,
            "SEO_CANONICAL_PRESENT",
            "SEO_CANONICAL_MISSING",
        ),
        seo_check(
            html.has_open_graph,
            "SEO_OPEN_GRAPH_PRESENT",
            "SEO_OPEN_GRAPH_MISSING",
        ),
        seo_check(
            html.has_favicon,
            "SEO_FAVICON_PRESENT",
            "SEO_FAVICON_MISSING",
        ),
    ];
    let passed = checks
        .iter()
        .filter(|check| check.status == SeoCheckStatus::Pass)
        .count();
    let score = u8::try_from((passed * 100 + checks.len() / 2) / checks.len())
        .expect("six SEO checks always fit in u8");
    ArtifactSeoSummary { score, checks }
}

fn seo_check(passed: bool, pass_code: &str, warning_code: &str) -> ArtifactSeoCheck {
    ArtifactSeoCheck {
        code: if passed { pass_code } else { warning_code }.to_owned(),
        status: if passed {
            SeoCheckStatus::Pass
        } else {
            SeoCheckStatus::Warning
        },
    }
}

fn summarize_assets(manifest: &ArtifactManifest) -> ArtifactAssetSummary {
    let mut by_type = ArtifactAssetBreakdown {
        html: ArtifactAssetTypeSummary::default(),
        javascript: ArtifactAssetTypeSummary::default(),
        css: ArtifactAssetTypeSummary::default(),
        images: ArtifactAssetTypeSummary::default(),
        fonts: ArtifactAssetTypeSummary::default(),
        maps: ArtifactAssetTypeSummary::default(),
        other: ArtifactAssetTypeSummary::default(),
    };
    for entry in &manifest.files {
        let summary = classify_file(&mut by_type, &entry.path);
        summary.count = summary.count.saturating_add(1);
        summary.total_size = summary.total_size.saturating_add(entry.size);
    }
    let mut largest_files = manifest
        .files
        .iter()
        .map(|entry| ArtifactFileSummary {
            path: entry.path.clone(),
            size: entry.size,
        })
        .collect::<Vec<_>>();
    largest_files.sort_by(|left, right| {
        right
            .size
            .cmp(&left.size)
            .then_with(|| left.path.cmp(&right.path))
    });
    largest_files.truncate(5);

    ArtifactAssetSummary {
        total_files: u32::try_from(manifest.files.len()).unwrap_or(u32::MAX),
        total_size: manifest
            .files
            .iter()
            .fold(0_u64, |total, entry| total.saturating_add(entry.size)),
        by_type,
        largest_files,
    }
}

fn classify_file<'a>(
    breakdown: &'a mut ArtifactAssetBreakdown,
    path: &str,
) -> &'a mut ArtifactAssetTypeSummary {
    let extension = path
        .rsplit_once('.')
        .map(|(_, extension)| extension.to_ascii_lowercase());
    match extension.as_deref() {
        Some("html" | "htm") => &mut breakdown.html,
        Some("js" | "mjs" | "cjs") => &mut breakdown.javascript,
        Some("css") => &mut breakdown.css,
        Some("map") => &mut breakdown.maps,
        Some("png" | "jpg" | "jpeg" | "gif" | "webp" | "avif" | "svg" | "ico") => {
            &mut breakdown.images
        }
        Some("woff" | "woff2" | "ttf" | "otf" | "eot") => &mut breakdown.fonts,
        _ => &mut breakdown.other,
    }
}

fn push_issue_once(items: &mut Vec<ArtifactReportIssue>, level: ArtifactIssueLevel, code: &str) {
    if !items.iter().any(|item| item.code == code) {
        items.push(ArtifactReportIssue {
            level,
            code: code.to_owned(),
        });
    }
}

fn read_text_prefix(path: &Path, maximum_bytes: u64) -> Result<String, ArtifactError> {
    let file = File::open(path).map_err(ArtifactError::Io)?;
    let mut bytes = Vec::with_capacity(usize::try_from(maximum_bytes).unwrap_or(0));
    let mut limited: Take<File> = file.take(maximum_bytes);
    limited.read_to_end(&mut bytes).map_err(ArtifactError::Io)?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}
