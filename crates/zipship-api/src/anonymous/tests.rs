use super::*;
use axum::http::HeaderValue;

#[test]
fn ignores_spoofed_forwarding_from_untrusted_peers() {
    let policy = AnonymousRequestPolicy::try_new(["10.0.0.0/8".to_owned()]).unwrap();
    let headers = HeaderMap::from_iter([(
        "x-forwarded-for".parse().unwrap(),
        HeaderValue::from_static("203.0.113.9"),
    )]);
    assert_eq!(
        policy.client_ip("198.51.100.8".parse().unwrap(), &headers),
        "198.51.100.8".parse::<IpAddr>().unwrap()
    );
}

#[test]
fn removes_only_trusted_proxy_hops_from_the_right() {
    let policy =
        AnonymousRequestPolicy::try_new(["10.0.0.0/8".to_owned(), "2001:db8:10::/48".to_owned()])
            .unwrap();
    let headers = HeaderMap::from_iter([(
        "x-forwarded-for".parse().unwrap(),
        HeaderValue::from_static("192.0.2.77, 10.1.1.8"),
    )]);
    assert_eq!(
        policy.client_ip("10.2.2.9".parse().unwrap(), &headers),
        "192.0.2.77".parse::<IpAddr>().unwrap()
    );
}

#[test]
fn rate_limits_each_endpoint_and_client_independently() {
    let limiter = AnonymousRateLimiter::default();
    let now = Instant::now();
    let first = "192.0.2.1".parse().unwrap();
    let second = "192.0.2.2".parse().unwrap();
    for _ in 0..REQUEST_LIMIT {
        assert!(limiter.allow_at(first, AnonymousEndpoint::Request, now));
    }
    assert!(!limiter.allow_at(first, AnonymousEndpoint::Request, now));
    assert!(limiter.allow_at(second, AnonymousEndpoint::Request, now));
    assert!(limiter.allow_at(first, AnonymousEndpoint::Confirm, now));
    assert!(limiter.allow_at(first, AnonymousEndpoint::Request, now + REQUEST_WINDOW));
}

#[test]
fn validates_proxy_networks_and_ipv4_mapped_addresses() {
    assert_eq!(
        AnonymousRequestPolicy::try_new(["10.0.0.1/99".to_owned()])
            .err()
            .unwrap(),
        InvalidAnonymousRequestPolicy::InvalidTrustedProxy("10.0.0.1/99".to_owned())
    );
    let network = IpNetwork::parse("192.0.2.0/24").unwrap();
    assert!(network.contains("::ffff:192.0.2.8".parse().unwrap()));
}
