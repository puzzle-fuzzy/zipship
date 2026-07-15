use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use zipship_domain::ArtifactDigest;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ArtifactLimits {
    pub maximum_entries: usize,
    pub maximum_file_bytes: u64,
    pub maximum_expanded_bytes: u64,
    pub maximum_path_depth: usize,
    pub maximum_compression_ratio: u64,
    pub compression_ratio_grace_bytes: u64,
}

impl Default for ArtifactLimits {
    fn default() -> Self {
        Self {
            maximum_entries: 25_000,
            maximum_file_bytes: 128 * 1_024 * 1_024,
            maximum_expanded_bytes: 2 * 1_024 * 1_024 * 1_024,
            maximum_path_depth: 32,
            maximum_compression_ratio: 200,
            compression_ratio_grace_bytes: 1_024 * 1_024,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactManifest {
    pub version: u32,
    pub files: Vec<ManifestEntry>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestEntry {
    pub path: String,
    pub size: u64,
    pub sha256: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExtractedArtifact {
    pub root: PathBuf,
    pub digest: ArtifactDigest,
    pub manifest: ArtifactManifest,
    pub file_count: u32,
    pub total_size: u64,
}
