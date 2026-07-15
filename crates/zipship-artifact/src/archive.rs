use std::{
    collections::HashMap,
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
};

use sha2::{Digest, Sha256};
use unicode_normalization::UnicodeNormalization;
use zip::{CompressionMethod, ZipArchive, read::ZipFile, result::ZipError};

use crate::{
    ArtifactError, ArtifactLimits, ExtractedArtifact,
    central_directory::validate_central_directory,
    manifest::{ExtractedFile, build_artifact_result},
};

const COPY_BUFFER_BYTES: usize = 64 * 1_024;
const MAX_ENTRY_PATH_BYTES: usize = 4_096;

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
    let mut archive = ZipArchive::new(archive_file).map_err(map_archive_metadata_error)?;
    validate_central_directory(
        archive_path,
        archive.central_directory_start(),
        archive.len(),
        limits.maximum_entries,
    )?;
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
            .map_err(map_archive_metadata_error)?;
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

fn map_archive_metadata_error(error: ZipError) -> ArtifactError {
    match error {
        ZipError::Io(error) => map_archive_read_error(error),
        ZipError::CompressionMethodNotSupported(_) => ArtifactError::UnsupportedCompression,
        ZipError::UnsupportedArchive(
            "Encrypted files are not supported" | ZipError::PASSWORD_REQUIRED,
        ) => ArtifactError::EncryptedArchive,
        _ => ArtifactError::InvalidArchive,
    }
}
