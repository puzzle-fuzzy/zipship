const RESERVED_PROJECT_SLUGS: &[&str] = &[
    "_api",
    "_console",
    "_health",
    "_assets",
    "favicon.ico",
    "robots.txt",
];

pub(super) fn parse_slug(value: &str, check_reserved: bool) -> Option<String> {
    let valid_length = !value.is_empty() && value.len() <= 63;
    let valid_start = value.as_bytes().first().is_some_and(u8::is_ascii_lowercase)
        || value.as_bytes().first().is_some_and(u8::is_ascii_digit);
    let valid_chars = value.bytes().all(|byte| {
        byte.is_ascii_lowercase() || byte.is_ascii_digit() || matches!(byte, b'-' | b'_')
    });
    let reserved = check_reserved && RESERVED_PROJECT_SLUGS.contains(&value);
    (valid_length && valid_start && valid_chars && !reserved).then(|| value.to_owned())
}

pub(super) fn normalize_bounded_name(value: &str, max_characters: usize) -> Option<String> {
    let normalized = value.trim();
    let character_count = normalized.chars().count();
    (character_count > 0
        && character_count <= max_characters
        && !normalized.chars().any(char::is_control))
    .then(|| normalized.to_owned())
}
