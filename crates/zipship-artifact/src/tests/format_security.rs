use super::*;

const LOCAL_FILE_HEADER: [u8; 4] = [0x50, 0x4b, 0x03, 0x04];
const CENTRAL_DIRECTORY_HEADER: [u8; 4] = [0x50, 0x4b, 0x01, 0x02];

#[test]
fn rejects_entries_marked_as_encrypted_before_reading_contents() {
    let temp = tempdir().unwrap();
    let archive = temp.path().join("encrypted.zip");
    write_zip(&archive, &[("index.html", b"index")]);
    patch_header_u16(&archive, 6, 8, |flags| flags | 1);

    let error = extract_artifact(
        &archive,
        &temp.path().join("expanded"),
        ArtifactLimits::default(),
    )
    .unwrap_err();
    assert_eq!(error.code(), "ENCRYPTED_ZIP_UNSUPPORTED");
}

#[test]
fn rejects_compression_methods_outside_stored_and_deflated() {
    let temp = tempdir().unwrap();
    let archive = temp.path().join("unsupported-compression.zip");
    write_zip(&archive, &[("index.html", b"index")]);
    patch_header_u16(&archive, 8, 10, |_| 12);

    let error = extract_artifact(
        &archive,
        &temp.path().join("expanded"),
        ArtifactLimits::default(),
    )
    .unwrap_err();
    assert_eq!(error.code(), "UNSUPPORTED_ZIP_COMPRESSION");
}

fn patch_header_u16(
    path: &Path,
    local_field_offset: usize,
    central_field_offset: usize,
    update: impl Fn(u16) -> u16,
) {
    let mut bytes = fs::read(path).unwrap();
    for (signature, field_offset) in [
        (LOCAL_FILE_HEADER, local_field_offset),
        (CENTRAL_DIRECTORY_HEADER, central_field_offset),
    ] {
        let positions = bytes
            .windows(signature.len())
            .enumerate()
            .filter_map(|(offset, value)| (value == signature).then_some(offset))
            .collect::<Vec<_>>();
        assert_eq!(
            positions.len(),
            1,
            "fixture must contain one matching header"
        );
        let field = positions[0] + field_offset;
        let current = u16::from_le_bytes([bytes[field], bytes[field + 1]]);
        bytes[field..field + 2].copy_from_slice(&update(current).to_le_bytes());
    }
    fs::write(path, bytes).unwrap();
}
