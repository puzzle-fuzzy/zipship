use axum::{
    body::Body,
    http::{HeaderMap, HeaderName, HeaderValue, Method, Response, StatusCode, header},
};
use zipship_domain::CachePolicy;

pub(super) fn error_response(status: StatusCode) -> Response<Body> {
    let mut response = Response::new(Body::empty());
    *response.status_mut() = status;
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    if status == StatusCode::SERVICE_UNAVAILABLE {
        response
            .headers_mut()
            .insert(header::RETRY_AFTER, HeaderValue::from_static("1"));
    }
    response
}

pub(super) fn metadata_only_response(
    status: StatusCode,
    etag: &str,
    cache_control: &'static str,
    vary_accept: bool,
) -> Response<Body> {
    let mut response = Response::new(Body::empty());
    *response.status_mut() = status;
    insert_header(response.headers_mut(), header::ETAG, etag);
    response.headers_mut().insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static(cache_control),
    );
    response
        .headers_mut()
        .insert(header::ACCEPT_RANGES, HeaderValue::from_static("bytes"));
    if vary_accept {
        response
            .headers_mut()
            .insert(header::VARY, HeaderValue::from_static("Accept"));
    }
    response
}

pub(super) fn range_not_satisfiable_response(
    size: u64,
    etag: &str,
    cache_control: &'static str,
    vary_accept: bool,
) -> Response<Body> {
    let mut response = metadata_only_response(
        StatusCode::RANGE_NOT_SATISFIABLE,
        etag,
        cache_control,
        vary_accept,
    );
    insert_header(
        response.headers_mut(),
        header::CONTENT_RANGE,
        format!("bytes */{size}"),
    );
    response
}

pub(super) fn insert_header(headers: &mut HeaderMap, name: HeaderName, value: impl AsRef<str>) {
    if let Ok(value) = HeaderValue::from_str(value.as_ref()) {
        headers.insert(name, value);
    }
}

pub(super) fn accepts_html(headers: &HeaderMap) -> bool {
    headers
        .get(header::ACCEPT)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|accept| {
            accept.split(',').any(|item| {
                let media_type = item.split(';').next().unwrap_or(item).trim();
                matches!(media_type, "text/html" | "application/xhtml+xml")
            })
        })
}

pub(super) fn if_none_match(headers: &HeaderMap, etag: &str) -> bool {
    headers
        .get(header::IF_NONE_MATCH)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| {
            value.split(',').any(|candidate| {
                let candidate = candidate.trim();
                candidate == "*" || candidate.strip_prefix("W/").unwrap_or(candidate) == etag
            })
        })
}

pub(super) fn content_type(path: &str) -> String {
    let mime = mime_guess::from_path(path).first_or_octet_stream();
    let value = mime.as_ref();
    if value.starts_with("text/")
        || value.ends_with("javascript")
        || value.ends_with("json")
        || value.ends_with("xml")
        || value.ends_with("svg+xml")
    {
        format!("{value}; charset=utf-8")
    } else {
        value.to_owned()
    }
}

pub(super) fn cache_control(path: &str, policy: CachePolicy) -> &'static str {
    if path.ends_with(".html") {
        "no-cache"
    } else if policy == CachePolicy::Aggressive {
        "public, max-age=31536000, immutable"
    } else {
        "public, max-age=3600"
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum RangeSelection {
    Full,
    Partial { start: u64, end: u64 },
    Unsatisfiable,
}

pub(super) fn requested_range(
    method: &Method,
    headers: &HeaderMap,
    etag: &str,
    size: u64,
) -> RangeSelection {
    if method != Method::GET || size == 0 {
        return RangeSelection::Full;
    }
    let Some(range) = headers
        .get(header::RANGE)
        .and_then(|value| value.to_str().ok())
    else {
        return RangeSelection::Full;
    };
    if headers
        .get(header::IF_RANGE)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|if_range| if_range != etag)
    {
        return RangeSelection::Full;
    }
    let Some((unit, specification)) = range.split_once('=') else {
        return RangeSelection::Full;
    };
    if !unit.eq_ignore_ascii_case("bytes") || specification.contains(',') {
        return RangeSelection::Full;
    }
    let Some((first, last)) = specification.split_once('-') else {
        return RangeSelection::Full;
    };
    if last.contains('-') {
        return RangeSelection::Full;
    }

    if first.is_empty() {
        let Ok(suffix_length) = last.parse::<u64>() else {
            return RangeSelection::Full;
        };
        if suffix_length == 0 {
            return RangeSelection::Unsatisfiable;
        }
        return RangeSelection::Partial {
            start: size.saturating_sub(suffix_length),
            end: size - 1,
        };
    }

    let Ok(start) = first.parse::<u64>() else {
        return RangeSelection::Full;
    };
    if start >= size {
        return RangeSelection::Unsatisfiable;
    }
    let end = if last.is_empty() {
        size - 1
    } else {
        let Ok(end) = last.parse::<u64>() else {
            return RangeSelection::Full;
        };
        if end < start {
            return RangeSelection::Full;
        }
        end.min(size - 1)
    };
    RangeSelection::Partial { start, end }
}
