use std::{collections::HashSet, path::Path};

use sha2::{Digest, Sha256};
use zipship_domain::ArtifactDigest;

use crate::{ArtifactError, ArtifactManifest, ExtractedArtifact, ManifestEntry};

#[derive(Debug)]
pub(super) struct ExtractedFile {
    pub(super) components: Vec<String>,
    pub(super) size: u64,
    pub(super) digest: [u8; 32],
}

pub(super) fn build_artifact_result(
    destination: &Path,
    extracted_files: Vec<ExtractedFile>,
) -> Result<ExtractedArtifact, ArtifactError> {
    let index_roots = extracted_files
        .iter()
        .filter(|file| {
            file.components
                .last()
                .is_some_and(|name| name == "index.html")
        })
        .map(|file| file.components[..file.components.len() - 1].to_vec())
        .collect::<Vec<_>>();
    let shallowest = index_roots
        .iter()
        .map(Vec::len)
        .min()
        .ok_or(ArtifactError::MissingIndex)?;
    let candidate_roots = index_roots
        .into_iter()
        .filter(|root| root.len() == shallowest)
        .collect::<HashSet<_>>();
    if candidate_roots.len() != 1 {
        return Err(ArtifactError::AmbiguousIndex);
    }
    let Some(root_components) = candidate_roots.into_iter().next() else {
        return Err(ArtifactError::AmbiguousIndex);
    };
    let mut manifest_files = extracted_files
        .into_iter()
        .filter_map(|file| {
            file.components
                .starts_with(&root_components)
                .then_some((file, root_components.len()))
        })
        .map(|(file, root_length)| ManifestEntry {
            path: file.components[root_length..].join("/"),
            size: file.size,
            sha256: hex_digest(file.digest),
        })
        .collect::<Vec<_>>();
    manifest_files.sort_by(|left, right| left.path.cmp(&right.path));
    let file_count =
        u32::try_from(manifest_files.len()).map_err(|_| ArtifactError::TooManyEntries)?;
    let total_size = manifest_files
        .iter()
        .try_fold(0_u64, |total, entry| total.checked_add(entry.size))
        .ok_or(ArtifactError::ExpandedDataTooLarge)?;
    let digest = manifest_digest(&manifest_files);
    Ok(ExtractedArtifact {
        root: root_components
            .iter()
            .fold(destination.to_path_buf(), |path, component| {
                path.join(component)
            }),
        digest: ArtifactDigest::parse(hex_digest(digest))
            .expect("SHA-256 output is always a valid artifact digest"),
        manifest: ArtifactManifest {
            version: 1,
            files: manifest_files,
        },
        file_count,
        total_size,
    })
}

fn manifest_digest(files: &[ManifestEntry]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(b"zipship-artifact-manifest-v1\0");
    for file in files {
        hasher.update((file.path.len() as u64).to_be_bytes());
        hasher.update(file.path.as_bytes());
        hasher.update(file.size.to_be_bytes());
        hasher.update(file.sha256.as_bytes());
    }
    hasher.finalize().into()
}

fn hex_digest(digest: [u8; 32]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut output = String::with_capacity(64);
    for byte in digest {
        output.push(HEX[(byte >> 4) as usize] as char);
        output.push(HEX[(byte & 0x0f) as usize] as char);
    }
    output
}
