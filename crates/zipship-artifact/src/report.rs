use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactDetectReport {
    pub report_version: u32,
    pub manifest_version: u32,
    pub entry_point: String,
    pub level: ArtifactReportLevel,
    pub items: Vec<ArtifactReportIssue>,
    pub insights: ArtifactInsights,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ArtifactReportLevel {
    Pass,
    Warning,
    Failed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactReportIssue {
    pub level: ArtifactIssueLevel,
    pub code: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ArtifactIssueLevel {
    Info,
    Warning,
    Failed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactInsights {
    pub entrypoint: String,
    pub assets: ArtifactAssetSummary,
    pub html: ArtifactHtmlMetadata,
    pub seo: ArtifactSeoSummary,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactAssetSummary {
    pub total_files: u32,
    pub total_size: u64,
    pub by_type: ArtifactAssetBreakdown,
    pub largest_files: Vec<ArtifactFileSummary>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactAssetBreakdown {
    pub html: ArtifactAssetTypeSummary,
    pub javascript: ArtifactAssetTypeSummary,
    pub css: ArtifactAssetTypeSummary,
    pub images: ArtifactAssetTypeSummary,
    pub fonts: ArtifactAssetTypeSummary,
    pub maps: ArtifactAssetTypeSummary,
    pub other: ArtifactAssetTypeSummary,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactAssetTypeSummary {
    pub count: u32,
    pub total_size: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactFileSummary {
    pub path: String,
    pub size: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactHtmlMetadata {
    pub title: Option<String>,
    pub description: Option<String>,
    pub has_viewport: bool,
    pub has_canonical: bool,
    pub has_open_graph: bool,
    pub has_twitter_card: bool,
    pub has_favicon: bool,
    pub lang: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactSeoSummary {
    pub score: u8,
    pub checks: Vec<ArtifactSeoCheck>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactSeoCheck {
    pub code: String,
    pub status: SeoCheckStatus,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SeoCheckStatus {
    Pass,
    Warning,
}
