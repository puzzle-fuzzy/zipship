use super::*;

#[test]
fn requires_a_full_lowercase_sha256_digest() {
    let digest = "0123456789abcdef".repeat(4);
    assert_eq!(ArtifactDigest::parse(&digest).unwrap().as_str(), digest);
    assert!(ArtifactDigest::parse("0123456789ab").is_err());
    assert!(ArtifactDigest::parse("A".repeat(64)).is_err());
}
