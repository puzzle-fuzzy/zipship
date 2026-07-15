use axum::http::{HeaderMap, HeaderValue, Method, header};

use crate::http_policy::{
    RangeSelection, accepts_html, cache_control, content_type, if_none_match, requested_range,
};
use zipship_domain::CachePolicy;

#[test]
fn recognizes_explicit_html_navigation_media_types() {
    let mut headers = HeaderMap::new();
    headers.insert(
        header::ACCEPT,
        HeaderValue::from_static("application/json, Text/HTML; charset=utf-8; q=0.5"),
    );
    assert!(accepts_html(&headers));

    headers.insert(header::ACCEPT, HeaderValue::from_static("*/*"));
    assert!(!accepts_html(&headers));
}

#[test]
fn rejects_html_media_ranges_with_zero_or_invalid_quality() {
    let mut headers = HeaderMap::new();
    headers.insert(
        header::ACCEPT,
        HeaderValue::from_static("text/html;q=0, application/xhtml+xml;Q=0.000"),
    );
    assert!(!accepts_html(&headers));

    headers.insert(
        header::ACCEPT,
        HeaderValue::from_static("text/html;q=1.001, application/xhtml+xml;q=invalid"),
    );
    assert!(!accepts_html(&headers));
}

#[test]
fn matches_strong_weak_and_wildcard_conditional_etags() {
    let mut headers = HeaderMap::new();
    headers.insert(
        header::IF_NONE_MATCH,
        HeaderValue::from_static("\"other\", W/\"current\""),
    );
    assert!(if_none_match(&headers, "\"current\""));
    assert!(!if_none_match(&headers, "\"missing\""));

    headers.insert(header::IF_NONE_MATCH, HeaderValue::from_static("*"));
    assert!(if_none_match(&headers, "\"anything\""));
}

#[test]
fn selects_closed_open_suffix_and_unsatisfiable_ranges() {
    let mut headers = HeaderMap::new();
    headers.insert(header::RANGE, HeaderValue::from_static("bytes=2-5"));
    assert_eq!(
        requested_range(&Method::GET, &headers, "\"etag\"", 20),
        RangeSelection::Partial { start: 2, end: 5 }
    );

    headers.insert(header::RANGE, HeaderValue::from_static("bytes=18-"));
    assert_eq!(
        requested_range(&Method::GET, &headers, "\"etag\"", 20),
        RangeSelection::Partial { start: 18, end: 19 }
    );

    headers.insert(header::RANGE, HeaderValue::from_static("bytes=-3"));
    assert_eq!(
        requested_range(&Method::GET, &headers, "\"etag\"", 20),
        RangeSelection::Partial { start: 17, end: 19 }
    );

    headers.insert(header::RANGE, HeaderValue::from_static("bytes=20-"));
    assert_eq!(
        requested_range(&Method::GET, &headers, "\"etag\"", 20),
        RangeSelection::Unsatisfiable
    );
}

#[test]
fn falls_back_to_full_responses_for_non_get_or_stale_if_range() {
    let mut headers = HeaderMap::new();
    headers.insert(header::RANGE, HeaderValue::from_static("bytes=2-5"));
    assert_eq!(
        requested_range(&Method::HEAD, &headers, "\"etag\"", 20),
        RangeSelection::Full
    );

    headers.insert(header::IF_RANGE, HeaderValue::from_static("\"stale\""));
    assert_eq!(
        requested_range(&Method::GET, &headers, "\"etag\"", 20),
        RangeSelection::Full
    );
}

#[test]
fn derives_safe_content_types_and_cache_policies() {
    assert_eq!(content_type("index.html"), "text/html; charset=utf-8");
    assert_eq!(content_type("image.png"), "image/png");
    assert_eq!(
        cache_control("index.html", CachePolicy::Aggressive),
        "no-cache"
    );
    assert_eq!(
        cache_control("app.js", CachePolicy::Aggressive),
        "public, max-age=31536000, immutable"
    );
    assert_eq!(
        cache_control("app.js", CachePolicy::Standard),
        "public, max-age=3600"
    );
}
