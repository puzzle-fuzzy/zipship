use super::*;

#[test]
fn validates_stream_headers_without_allocating_the_body() {
    let mut headers = HeaderMap::new();
    assert!(declared_body_size(&headers, 100).is_err());
    headers.insert(header::CONTENT_LENGTH, "101".parse().unwrap());
    assert!(declared_body_size(&headers, 100).is_err());
    headers.insert(header::CONTENT_LENGTH, "100".parse().unwrap());
    headers.insert(header::CONTENT_TYPE, "application/zip".parse().unwrap());
    assert_eq!(declared_body_size(&headers, 100).unwrap(), 100);
    assert!(require_zip_content_type(&headers).is_ok());
}
