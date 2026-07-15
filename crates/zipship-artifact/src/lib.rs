#![forbid(unsafe_code)]

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    error::Error as StdError,
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
};
use thiserror::Error;
use time::OffsetDateTime;
use unicode_normalization::UnicodeNormalization;
use uuid::Uuid;
use zip::{CompressionMethod, ZipArchive, read::ZipFile};
use zipship_domain::ArtifactDigest;
use zipship_jobs::WorkerId;

const COPY_BUFFER_BYTES: usize = 64 * 1_024;
const MAX_ENTRY_PATH_BYTES: usize = 4_096;

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

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ArtifactJobContext {
    pub job_id: Uuid,
    pub upload_id: Uuid,
    pub project_id: Uuid,
    pub release_id: Uuid,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReadyArtifact {
    pub digest: ArtifactDigest,
    pub storage_key: String,
    pub manifest: ArtifactManifest,
    pub file_count: u32,
    pub total_size: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ArtifactJobCompletion {
    pub artifact_id: Uuid,
    pub reused_artifact: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ArtifactFailureOutcome {
    RetryScheduled,
    Terminal,
}

#[derive(Debug, Error)]
pub enum ArtifactJobsRepositoryError {
    #[error("artifact job lease is no longer owned by this worker")]
    LeaseLost,
    #[error("artifact job does not reference a valid processing upload and release")]
    InvalidContext,
    #[error("an existing artifact disagrees with the same content digest")]
    ArtifactConflict,
    #[error("artifact jobs repository is unavailable")]
    Unavailable {
        #[source]
        source: Box<dyn StdError + Send + Sync>,
    },
}

impl ArtifactJobsRepositoryError {
    pub fn unavailable(source: impl StdError + Send + Sync + 'static) -> Self {
        Self::Unavailable {
            source: Box::new(source),
        }
    }
}

#[async_trait]
pub trait ArtifactJobsRepository: Send + Sync + 'static {
    async fn load_context(
        &self,
        job_id: Uuid,
        worker_id: &WorkerId,
    ) -> Result<ArtifactJobContext, ArtifactJobsRepositoryError>;

    async fn complete_artifact_job(
        &self,
        context: &ArtifactJobContext,
        worker_id: &WorkerId,
        artifact: &ReadyArtifact,
    ) -> Result<ArtifactJobCompletion, ArtifactJobsRepositoryError>;

    async fn fail_artifact_job(
        &self,
        job_id: Uuid,
        worker_id: &WorkerId,
        error_code: &str,
        error_detail: &Value,
        retry_at: Option<OffsetDateTime>,
    ) -> Result<ArtifactFailureOutcome, ArtifactJobsRepositoryError>;
}

#[derive(Debug, Error)]
pub enum ArtifactError {
    #[error("artifact filesystem operation failed")]
    Io(#[source] std::io::Error),
    #[error("archive is not a valid ZIP file")]
    InvalidArchive,
    #[error("encrypted ZIP entries are not accepted")]
    EncryptedArchive,
    #[error("ZIP entry path is unsafe or non-portable")]
    UnsafePath,
    #[error("ZIP entry type is not a regular file or directory")]
    UnsupportedEntryType,
    #[error("ZIP compression method is not supported")]
    UnsupportedCompression,
    #[error("ZIP contains too many entries")]
    TooManyEntries,
    #[error("ZIP entry exceeds the per-file size limit")]
    FileTooLarge,
    #[error("ZIP expanded data exceeds the total size limit")]
    ExpandedDataTooLarge,
    #[error("ZIP entry exceeds the compression ratio limit")]
    CompressionRatioExceeded,
    #[error("ZIP contains duplicate or case-colliding paths")]
    DuplicatePath,
    #[error("ZIP contains a file/directory path conflict")]
    PathConflict,
    #[error("ZIP entry exceeds the path depth limit")]
    PathTooDeep,
    #[error("artifact destination already exists")]
    DestinationExists,
    #[error("artifact has no index.html entry point")]
    MissingIndex,
    #[error("artifact has multiple equally plausible index.html roots")]
    AmbiguousIndex,
}

impl ArtifactError {
    pub const fn code(&self) -> &'static str {
        match self {
            Self::Io(_) => "ARTIFACT_IO_FAILURE",
            Self::InvalidArchive => "INVALID_ZIP_ARCHIVE",
            Self::EncryptedArchive => "ENCRYPTED_ZIP_UNSUPPORTED",
            Self::UnsafePath => "UNSAFE_ZIP_PATH",
            Self::UnsupportedEntryType => "UNSUPPORTED_ZIP_ENTRY_TYPE",
            Self::UnsupportedCompression => "UNSUPPORTED_ZIP_COMPRESSION",
            Self::TooManyEntries => "ZIP_ENTRY_LIMIT_EXCEEDED",
            Self::FileTooLarge => "ZIP_FILE_SIZE_LIMIT_EXCEEDED",
            Self::ExpandedDataTooLarge => "ZIP_EXPANDED_SIZE_LIMIT_EXCEEDED",
            Self::CompressionRatioExceeded => "ZIP_COMPRESSION_RATIO_EXCEEDED",
            Self::DuplicatePath => "DUPLICATE_ZIP_PATH",
            Self::PathConflict => "ZIP_PATH_CONFLICT",
            Self::PathTooDeep => "ZIP_PATH_DEPTH_EXCEEDED",
            Self::DestinationExists => "ARTIFACT_DESTINATION_EXISTS",
            Self::MissingIndex => "ARTIFACT_INDEX_MISSING",
            Self::AmbiguousIndex => "ARTIFACT_INDEX_AMBIGUOUS",
        }
    }

    pub const fn retryable(&self) -> bool {
        matches!(self, Self::Io(_))
    }
}

pub fn extract_artifact(
    archive_path: &Path,
    destination: &Path,
    limits: ArtifactLimits,
) -> Result<ExtractedArtifact, ArtifactError> {
    if destination.try_exists().map_err(ArtifactError::Io)? {
        return Err(ArtifactError::DestinationExists);
    }
    fs::create_dir_all(destination).map_err(ArtifactError::Io)?;
    let result = extract_artifact_inner(archive_path, destination, limits);
    if result.is_err() {
        let _ = fs::remove_dir_all(destination);
    }
    result
}

fn extract_artifact_inner(
    archive_path: &Path,
    destination: &Path,
    limits: ArtifactLimits,
) -> Result<ExtractedArtifact, ArtifactError> {
    let archive_file = File::open(archive_path).map_err(ArtifactError::Io)?;
    let mut archive = ZipArchive::new(archive_file).map_err(|_| ArtifactError::InvalidArchive)?;
    let entries = validate_archive(&mut archive, limits)?;
    let mut expanded_bytes = 0_u64;
    let mut extracted_files = Vec::new();

    for entry in &entries {
        if entry.is_directory {
            create_secure_directory(destination, &entry.components)?;
            continue;
        }
        create_secure_directory(destination, &entry.components[..entry.components.len() - 1])?;
        let output_path = join_components(destination, &entry.components);
        let mut output = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&output_path)
            .map_err(ArtifactError::Io)?;
        let mut input = archive
            .by_index(entry.archive_index)
            .map_err(|_| ArtifactError::InvalidArchive)?;
        let mut hasher = Sha256::new();
        let mut file_bytes = 0_u64;
        let mut buffer = vec![0_u8; COPY_BUFFER_BYTES];
        loop {
            let read = input.read(&mut buffer).map_err(map_archive_read_error)?;
            if read == 0 {
                break;
            }
            file_bytes = file_bytes
                .checked_add(read as u64)
                .ok_or(ArtifactError::FileTooLarge)?;
            expanded_bytes = expanded_bytes
                .checked_add(read as u64)
                .ok_or(ArtifactError::ExpandedDataTooLarge)?;
            if file_bytes > limits.maximum_file_bytes {
                return Err(ArtifactError::FileTooLarge);
            }
            if expanded_bytes > limits.maximum_expanded_bytes {
                return Err(ArtifactError::ExpandedDataTooLarge);
            }
            output
                .write_all(&buffer[..read])
                .map_err(ArtifactError::Io)?;
            hasher.update(&buffer[..read]);
        }
        if file_bytes != entry.declared_size {
            return Err(ArtifactError::InvalidArchive);
        }
        output.flush().map_err(ArtifactError::Io)?;
        output.sync_all().map_err(ArtifactError::Io)?;
        extracted_files.push(ExtractedFile {
            components: entry.components.clone(),
            size: file_bytes,
            digest: hasher.finalize().into(),
        });
    }

    build_artifact_result(destination, extracted_files)
}

#[derive(Debug)]
struct ValidatedEntry {
    archive_index: usize,
    components: Vec<String>,
    is_directory: bool,
    declared_size: u64,
}

fn validate_archive(
    archive: &mut ZipArchive<File>,
    limits: ArtifactLimits,
) -> Result<Vec<ValidatedEntry>, ArtifactError> {
    if archive.len() > limits.maximum_entries {
        return Err(ArtifactError::TooManyEntries);
    }
    let mut entries = Vec::with_capacity(archive.len());
    let mut exact_paths = HashMap::<String, bool>::new();
    let mut folded_paths = HashMap::<String, bool>::new();
    let mut folded_casing = HashMap::<String, String>::new();
    let mut declared_total = 0_u64;

    for archive_index in 0..archive.len() {
        let file = archive
            .by_index(archive_index)
            .map_err(|_| ArtifactError::InvalidArchive)?;
        validate_entry_type(&file)?;
        let components = validate_entry_path(&file, limits.maximum_path_depth)?;
        let path = components.join("/");
        let folded_path = path.to_lowercase();
        let is_directory = file.is_dir();
        validate_path_casing(&components, &mut folded_casing)?;
        validate_path_collision(
            &path,
            &folded_path,
            is_directory,
            &exact_paths,
            &folded_paths,
        )?;
        exact_paths.insert(path, is_directory);
        folded_paths.insert(folded_path, is_directory);

        if file.size() > limits.maximum_file_bytes {
            return Err(ArtifactError::FileTooLarge);
        }
        declared_total = declared_total
            .checked_add(file.size())
            .ok_or(ArtifactError::ExpandedDataTooLarge)?;
        if declared_total > limits.maximum_expanded_bytes {
            return Err(ArtifactError::ExpandedDataTooLarge);
        }
        validate_compression_ratio(file.size(), file.compressed_size(), limits)?;
        entries.push(ValidatedEntry {
            archive_index,
            components,
            is_directory,
            declared_size: file.size(),
        });
    }
    Ok(entries)
}

fn validate_path_casing(
    components: &[String],
    folded_casing: &mut HashMap<String, String>,
) -> Result<(), ArtifactError> {
    let mut exact = String::new();
    for component in components {
        if !exact.is_empty() {
            exact.push('/');
        }
        exact.push_str(component);
        let folded = exact.to_lowercase();
        if folded_casing
            .get(&folded)
            .is_some_and(|known| known != &exact)
        {
            return Err(ArtifactError::DuplicatePath);
        }
        folded_casing.entry(folded).or_insert_with(|| exact.clone());
    }
    Ok(())
}

fn validate_entry_type<R: Read>(file: &ZipFile<'_, R>) -> Result<(), ArtifactError> {
    if file.encrypted() {
        return Err(ArtifactError::EncryptedArchive);
    }
    if !matches!(
        file.compression(),
        CompressionMethod::Stored | CompressionMethod::Deflated
    ) {
        return Err(ArtifactError::UnsupportedCompression);
    }
    if file.is_symlink() {
        return Err(ArtifactError::UnsupportedEntryType);
    }
    if let Some(mode) = file.unix_mode() {
        let file_type = mode & 0o170_000;
        let valid_type = file_type == 0
            || (file.is_dir() && file_type == 0o040_000)
            || (file.is_file() && file_type == 0o100_000);
        if !valid_type {
            return Err(ArtifactError::UnsupportedEntryType);
        }
    }
    if !file.is_dir() && !file.is_file() {
        return Err(ArtifactError::UnsupportedEntryType);
    }
    Ok(())
}

fn validate_entry_path<R: Read>(
    file: &ZipFile<'_, R>,
    maximum_depth: usize,
) -> Result<Vec<String>, ArtifactError> {
    if file.enclosed_name().is_none() {
        return Err(ArtifactError::UnsafePath);
    }
    let raw = std::str::from_utf8(file.name_raw()).map_err(|_| ArtifactError::UnsafePath)?;
    if raw.is_empty()
        || raw.len() > MAX_ENTRY_PATH_BYTES
        || raw.contains(['\\', '\0'])
        || raw.chars().any(char::is_control)
        || raw.starts_with('/')
    {
        return Err(ArtifactError::UnsafePath);
    }
    let raw = raw.strip_suffix('/').unwrap_or(raw);
    if raw.is_empty() {
        return Err(ArtifactError::UnsafePath);
    }
    let components = raw
        .split('/')
        .map(validate_path_component)
        .collect::<Result<Vec<_>, _>>()?;
    if components.is_empty() {
        return Err(ArtifactError::UnsafePath);
    }
    if components.len() > maximum_depth {
        return Err(ArtifactError::PathTooDeep);
    }
    Ok(components)
}

fn validate_path_component(value: &str) -> Result<String, ArtifactError> {
    if value.is_empty()
        || matches!(value, "." | "..")
        || value.contains(':')
        || value.ends_with([' ', '.'])
        || value.nfc().ne(value.chars())
        || is_windows_reserved_name(value)
    {
        return Err(ArtifactError::UnsafePath);
    }
    Ok(value.to_owned())
}

fn is_windows_reserved_name(value: &str) -> bool {
    let stem = value
        .split('.')
        .next()
        .unwrap_or(value)
        .to_ascii_uppercase();
    matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || stem
            .strip_prefix("COM")
            .or_else(|| stem.strip_prefix("LPT"))
            .is_some_and(|suffix| {
                matches!(suffix, "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9")
            })
}

fn validate_path_collision(
    path: &str,
    folded_path: &str,
    is_directory: bool,
    exact_paths: &HashMap<String, bool>,
    folded_paths: &HashMap<String, bool>,
) -> Result<(), ArtifactError> {
    if exact_paths.contains_key(path) || folded_paths.contains_key(folded_path) {
        return Err(ArtifactError::DuplicatePath);
    }
    for parent in parent_paths(path) {
        if exact_paths.get(parent).is_some_and(|directory| !directory) {
            return Err(ArtifactError::PathConflict);
        }
    }
    for parent in parent_paths(folded_path) {
        if folded_paths.get(parent).is_some_and(|directory| !directory) {
            return Err(ArtifactError::PathConflict);
        }
    }
    if !is_directory {
        let child_prefix = format!("{path}/");
        let folded_child_prefix = format!("{folded_path}/");
        if exact_paths
            .keys()
            .any(|seen| seen.starts_with(&child_prefix))
            || folded_paths
                .keys()
                .any(|seen| seen.starts_with(&folded_child_prefix))
        {
            return Err(ArtifactError::PathConflict);
        }
    }
    Ok(())
}

fn parent_paths(path: &str) -> impl Iterator<Item = &str> {
    path.match_indices('/').map(|(index, _)| &path[..index])
}

fn validate_compression_ratio(
    expanded: u64,
    compressed: u64,
    limits: ArtifactLimits,
) -> Result<(), ArtifactError> {
    let allowed = compressed
        .saturating_mul(limits.maximum_compression_ratio)
        .saturating_add(limits.compression_ratio_grace_bytes);
    if expanded > allowed {
        Err(ArtifactError::CompressionRatioExceeded)
    } else {
        Ok(())
    }
}

fn create_secure_directory(root: &Path, components: &[String]) -> Result<(), ArtifactError> {
    let mut current = root.to_path_buf();
    for component in components {
        current.push(component);
        match fs::symlink_metadata(&current) {
            Ok(metadata) if metadata.file_type().is_dir() && !metadata.file_type().is_symlink() => {
            }
            Ok(_) => return Err(ArtifactError::PathConflict),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                fs::create_dir(&current).map_err(ArtifactError::Io)?;
            }
            Err(error) => return Err(ArtifactError::Io(error)),
        }
    }
    Ok(())
}

fn join_components(root: &Path, components: &[String]) -> PathBuf {
    components
        .iter()
        .fold(root.to_path_buf(), |path, component| path.join(component))
}

fn map_archive_read_error(error: std::io::Error) -> ArtifactError {
    if matches!(
        error.kind(),
        std::io::ErrorKind::InvalidData | std::io::ErrorKind::UnexpectedEof
    ) {
        ArtifactError::InvalidArchive
    } else {
        ArtifactError::Io(error)
    }
}

#[derive(Debug)]
struct ExtractedFile {
    components: Vec<String>,
    size: u64,
    digest: [u8; 32],
}

fn build_artifact_result(
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
    let root_components = candidate_roots.into_iter().next().unwrap();
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
        root: join_components(destination, &root_components),
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

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;
    use zip::{ZipWriter, write::SimpleFileOptions};

    fn write_zip(path: &Path, entries: &[(&str, &[u8])]) {
        let file = File::create(path).unwrap();
        let mut writer = ZipWriter::new(file);
        let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
        for (name, contents) in entries {
            writer.start_file(*name, options).unwrap();
            writer.write_all(contents).unwrap();
        }
        writer.finish().unwrap();
    }

    #[test]
    fn extracts_a_wrapped_site_and_hashes_the_manifest_deterministically() {
        let temp = tempdir().unwrap();
        let first_zip = temp.path().join("first.zip");
        let second_zip = temp.path().join("second.zip");
        write_zip(
            &first_zip,
            &[
                ("site/assets/app.js", b"console.log('ready')"),
                ("site/index.html", b"<main>ZipShip</main>"),
                ("README.txt", b"not part of the served artifact"),
            ],
        );
        write_zip(
            &second_zip,
            &[
                ("README.txt", b"not part of the served artifact"),
                ("site/index.html", b"<main>ZipShip</main>"),
                ("site/assets/app.js", b"console.log('ready')"),
            ],
        );

        let first = extract_artifact(
            &first_zip,
            &temp.path().join("first-expanded"),
            ArtifactLimits::default(),
        )
        .unwrap();
        let second = extract_artifact(
            &second_zip,
            &temp.path().join("second-expanded"),
            ArtifactLimits::default(),
        )
        .unwrap();
        assert!(first.root.ends_with(Path::new("first-expanded/site")));
        assert_eq!(first.digest, second.digest);
        assert_eq!(first.manifest, second.manifest);
        assert_eq!(first.file_count, 2);
        assert_eq!(
            first
                .manifest
                .files
                .iter()
                .map(|entry| entry.path.as_str())
                .collect::<Vec<_>>(),
            ["assets/app.js", "index.html"],
        );
        assert_eq!(
            fs::read_to_string(first.root.join("index.html")).unwrap(),
            "<main>ZipShip</main>",
        );
    }

    #[test]
    fn rejects_traversal_nonportable_and_case_colliding_paths() {
        for (name, entries, expected) in [
            (
                "traversal",
                vec![("../outside.txt", b"bad".as_slice())],
                "UNSAFE_ZIP_PATH",
            ),
            (
                "backslash",
                vec![("..\\outside.txt", b"bad".as_slice())],
                "UNSAFE_ZIP_PATH",
            ),
            (
                "reserved",
                vec![("site/CON.txt", b"bad".as_slice())],
                "UNSAFE_ZIP_PATH",
            ),
            (
                "collision",
                vec![
                    ("site/index.html", b"first".as_slice()),
                    ("site/INDEX.HTML", b"second".as_slice()),
                ],
                "DUPLICATE_ZIP_PATH",
            ),
            (
                "directory-casing",
                vec![
                    ("SITE/assets/app.js", b"first".as_slice()),
                    ("site/index.html", b"second".as_slice()),
                ],
                "DUPLICATE_ZIP_PATH",
            ),
        ] {
            let temp = tempdir().unwrap();
            let archive = temp.path().join(format!("{name}.zip"));
            let destination = temp.path().join("expanded");
            write_zip(&archive, &entries);
            let error =
                extract_artifact(&archive, &destination, ArtifactLimits::default()).unwrap_err();
            assert_eq!(error.code(), expected);
            assert!(!destination.exists());
            assert!(!temp.path().join("outside.txt").exists());
        }
    }

    #[test]
    fn rejects_symlinks_and_file_directory_conflicts() {
        let temp = tempdir().unwrap();
        let symlink_zip = temp.path().join("symlink.zip");
        let file = File::create(&symlink_zip).unwrap();
        let mut writer = ZipWriter::new(file);
        writer
            .add_symlink("site/link", "../../outside", SimpleFileOptions::default())
            .unwrap();
        writer.finish().unwrap();
        assert_eq!(
            extract_artifact(
                &symlink_zip,
                &temp.path().join("symlink-expanded"),
                ArtifactLimits::default(),
            )
            .unwrap_err()
            .code(),
            "UNSUPPORTED_ZIP_ENTRY_TYPE",
        );

        let conflict_zip = temp.path().join("conflict.zip");
        write_zip(
            &conflict_zip,
            &[("site", b"file"), ("site/index.html", b"<main></main>")],
        );
        assert_eq!(
            extract_artifact(
                &conflict_zip,
                &temp.path().join("conflict-expanded"),
                ArtifactLimits::default(),
            )
            .unwrap_err()
            .code(),
            "ZIP_PATH_CONFLICT",
        );
    }

    #[test]
    fn enforces_entry_size_total_size_depth_and_ratio_limits() {
        let temp = tempdir().unwrap();
        let archive = temp.path().join("limits.zip");
        write_zip(
            &archive,
            &[
                ("site/index.html", b"<main></main>"),
                ("site/assets/app.js", &vec![b'x'; 2 * 1_024 * 1_024]),
            ],
        );
        let strict_ratio = ArtifactLimits {
            maximum_compression_ratio: 10,
            compression_ratio_grace_bytes: 0,
            ..ArtifactLimits::default()
        };
        assert_eq!(
            extract_artifact(&archive, &temp.path().join("ratio"), strict_ratio)
                .unwrap_err()
                .code(),
            "ZIP_COMPRESSION_RATIO_EXCEEDED",
        );
        let strict_file = ArtifactLimits {
            maximum_file_bytes: 1_024,
            ..ArtifactLimits::default()
        };
        assert_eq!(
            extract_artifact(&archive, &temp.path().join("file"), strict_file)
                .unwrap_err()
                .code(),
            "ZIP_FILE_SIZE_LIMIT_EXCEEDED",
        );
        let strict_total = ArtifactLimits {
            maximum_expanded_bytes: 1_024,
            ..ArtifactLimits::default()
        };
        assert_eq!(
            extract_artifact(&archive, &temp.path().join("total"), strict_total)
                .unwrap_err()
                .code(),
            "ZIP_EXPANDED_SIZE_LIMIT_EXCEEDED",
        );

        let deep_zip = temp.path().join("deep.zip");
        write_zip(&deep_zip, &[("a/b/c/index.html", b"index")]);
        let shallow = ArtifactLimits {
            maximum_path_depth: 3,
            ..ArtifactLimits::default()
        };
        assert_eq!(
            extract_artifact(&deep_zip, &temp.path().join("deep"), shallow)
                .unwrap_err()
                .code(),
            "ZIP_PATH_DEPTH_EXCEEDED",
        );
    }

    #[test]
    fn requires_one_unambiguous_shallowest_index() {
        let temp = tempdir().unwrap();
        let missing = temp.path().join("missing.zip");
        write_zip(&missing, &[("site/readme.txt", b"missing")]);
        assert_eq!(
            extract_artifact(
                &missing,
                &temp.path().join("missing"),
                ArtifactLimits::default(),
            )
            .unwrap_err()
            .code(),
            "ARTIFACT_INDEX_MISSING",
        );

        let ambiguous = temp.path().join("ambiguous.zip");
        write_zip(
            &ambiguous,
            &[
                ("first/index.html", b"first"),
                ("second/index.html", b"second"),
            ],
        );
        assert_eq!(
            extract_artifact(
                &ambiguous,
                &temp.path().join("ambiguous"),
                ArtifactLimits::default(),
            )
            .unwrap_err()
            .code(),
            "ARTIFACT_INDEX_AMBIGUOUS",
        );
    }
}
