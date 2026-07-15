use std::{
    collections::HashSet,
    fs::File,
    io::{Read, Seek, SeekFrom},
    path::Path,
};

use crate::ArtifactError;

const CENTRAL_DIRECTORY_HEADER_BYTES: usize = 46;
const CENTRAL_DIRECTORY_SIGNATURE: [u8; 4] = [0x50, 0x4b, 0x01, 0x02];

pub(super) fn validate_central_directory(
    archive_path: &Path,
    directory_start: u64,
    parsed_entries: usize,
    maximum_entries: usize,
) -> Result<(), ArtifactError> {
    let mut archive = File::open(archive_path).map_err(ArtifactError::Io)?;
    archive
        .seek(SeekFrom::Start(directory_start))
        .map_err(ArtifactError::Io)?;

    let mut names = HashSet::new();
    let mut entry_count = 0_usize;
    loop {
        let mut header = [0_u8; CENTRAL_DIRECTORY_HEADER_BYTES];
        archive
            .read_exact(&mut header[..4])
            .map_err(map_central_directory_error)?;
        if header[..4] != CENTRAL_DIRECTORY_SIGNATURE {
            break;
        }
        archive
            .read_exact(&mut header[4..])
            .map_err(map_central_directory_error)?;

        entry_count = entry_count
            .checked_add(1)
            .ok_or(ArtifactError::TooManyEntries)?;
        if entry_count > maximum_entries {
            return Err(ArtifactError::TooManyEntries);
        }

        let name_length = usize::from(u16::from_le_bytes([header[28], header[29]]));
        let extra_length = u64::from(u16::from_le_bytes([header[30], header[31]]));
        let comment_length = u64::from(u16::from_le_bytes([header[32], header[33]]));
        let mut name = vec![0_u8; name_length];
        archive
            .read_exact(&mut name)
            .map_err(map_central_directory_error)?;
        if !names.insert(name) {
            return Err(ArtifactError::DuplicatePath);
        }
        let metadata_length = extra_length
            .checked_add(comment_length)
            .ok_or(ArtifactError::InvalidArchive)?;
        archive
            .seek(SeekFrom::Current(
                i64::try_from(metadata_length).map_err(|_| ArtifactError::InvalidArchive)?,
            ))
            .map_err(map_central_directory_error)?;
    }

    if entry_count != parsed_entries {
        return Err(ArtifactError::InvalidArchive);
    }
    Ok(())
}

fn map_central_directory_error(error: std::io::Error) -> ArtifactError {
    if error.kind() == std::io::ErrorKind::UnexpectedEof {
        ArtifactError::InvalidArchive
    } else {
        ArtifactError::Io(error)
    }
}
