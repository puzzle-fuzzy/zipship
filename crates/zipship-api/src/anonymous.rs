use axum::http::HeaderMap;
use std::{
    collections::{HashMap, VecDeque},
    net::IpAddr,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use thiserror::Error;

const REQUEST_WINDOW: Duration = Duration::from_secs(10 * 60);
const REQUEST_LIMIT: usize = 5;
const CONFIRM_WINDOW: Duration = Duration::from_secs(10 * 60);
const CONFIRM_LIMIT: usize = 10;
const SWEEP_INTERVAL: Duration = Duration::from_secs(60);
const MAX_TRACKED_BUCKETS: usize = 50_000;
const MAX_FORWARDED_HOPS: usize = 16;

#[derive(Debug, Error, PartialEq, Eq)]
pub enum InvalidAnonymousRequestPolicy {
    #[error("trusted proxy network is invalid: {0}")]
    InvalidTrustedProxy(String),
}

#[derive(Clone)]
pub struct AnonymousRequestPolicy {
    trusted_proxies: Arc<Vec<IpNetwork>>,
    limiter: AnonymousRateLimiter,
}

impl AnonymousRequestPolicy {
    pub fn direct() -> Self {
        Self {
            trusted_proxies: Arc::new(Vec::new()),
            limiter: AnonymousRateLimiter::default(),
        }
    }

    pub fn try_new(
        trusted_proxy_networks: impl IntoIterator<Item = String>,
    ) -> Result<Self, InvalidAnonymousRequestPolicy> {
        let trusted_proxies = trusted_proxy_networks
            .into_iter()
            .map(|value| {
                IpNetwork::parse(&value)
                    .ok_or(InvalidAnonymousRequestPolicy::InvalidTrustedProxy(value))
            })
            .collect::<Result<Vec<_>, _>>()?;
        Ok(Self {
            trusted_proxies: Arc::new(trusted_proxies),
            limiter: AnonymousRateLimiter::default(),
        })
    }

    pub(crate) fn client_ip(&self, peer: IpAddr, headers: &HeaderMap) -> IpAddr {
        let peer = canonical_ip(peer);
        if !self.is_trusted_proxy(peer) {
            return peer;
        }
        let Some(forwarded) = parse_forwarded_for(headers) else {
            return peer;
        };
        let mut current = peer;
        for hop in forwarded.iter().rev() {
            if !self.is_trusted_proxy(current) {
                return current;
            }
            current = *hop;
        }
        current
    }

    pub(crate) fn allow_password_reset_request(&self, client: IpAddr) -> bool {
        self.limiter.allow(client, AnonymousEndpoint::Request)
    }

    pub(crate) fn allow_password_reset_confirmation(&self, client: IpAddr) -> bool {
        self.limiter.allow(client, AnonymousEndpoint::Confirm)
    }

    fn is_trusted_proxy(&self, address: IpAddr) -> bool {
        self.trusted_proxies
            .iter()
            .any(|network| network.contains(address))
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
enum AnonymousEndpoint {
    Request,
    Confirm,
}

impl AnonymousEndpoint {
    const fn policy(self) -> (Duration, usize) {
        match self {
            Self::Request => (REQUEST_WINDOW, REQUEST_LIMIT),
            Self::Confirm => (CONFIRM_WINDOW, CONFIRM_LIMIT),
        }
    }
}

#[derive(Clone)]
struct AnonymousRateLimiter {
    state: Arc<Mutex<RateLimitState>>,
}

impl Default for AnonymousRateLimiter {
    fn default() -> Self {
        Self {
            state: Arc::new(Mutex::new(RateLimitState {
                buckets: HashMap::new(),
                next_sweep: Instant::now() + SWEEP_INTERVAL,
            })),
        }
    }
}

impl AnonymousRateLimiter {
    fn allow(&self, client: IpAddr, endpoint: AnonymousEndpoint) -> bool {
        self.allow_at(canonical_ip(client), endpoint, Instant::now())
    }

    fn allow_at(&self, client: IpAddr, endpoint: AnonymousEndpoint, now: Instant) -> bool {
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if now >= state.next_sweep {
            state.buckets.retain(|_, attempts| {
                attempts.back().is_some_and(|last| {
                    now.checked_duration_since(*last)
                        .is_none_or(|age| age < REQUEST_WINDOW.max(CONFIRM_WINDOW))
                })
            });
            state.next_sweep = now + SWEEP_INTERVAL;
        }
        let key = (client, endpoint);
        if !state.buckets.contains_key(&key) && state.buckets.len() >= MAX_TRACKED_BUCKETS {
            return false;
        }
        let (window, limit) = endpoint.policy();
        let attempts = state.buckets.entry(key).or_default();
        while attempts.front().is_some_and(|attempt| {
            now.checked_duration_since(*attempt)
                .is_some_and(|age| age >= window)
        }) {
            attempts.pop_front();
        }
        if attempts.len() >= limit {
            return false;
        }
        attempts.push_back(now);
        true
    }
}

struct RateLimitState {
    buckets: HashMap<(IpAddr, AnonymousEndpoint), VecDeque<Instant>>,
    next_sweep: Instant,
}

#[derive(Debug, Clone, Copy)]
enum IpNetwork {
    V4 { network: u32, prefix: u8 },
    V6 { network: u128, prefix: u8 },
}

impl IpNetwork {
    fn parse(value: &str) -> Option<Self> {
        let (address, prefix) = value
            .split_once('/')
            .map_or((value, None), |(address, prefix)| (address, Some(prefix)));
        match canonical_ip(address.parse().ok()?) {
            IpAddr::V4(address) => {
                let prefix = prefix.map_or(Some(32), |value| value.parse().ok())?;
                if prefix > 32 {
                    return None;
                }
                Some(Self::V4 {
                    network: u32::from(address) & ipv4_mask(prefix),
                    prefix,
                })
            }
            IpAddr::V6(address) => {
                let prefix = prefix.map_or(Some(128), |value| value.parse().ok())?;
                if prefix > 128 {
                    return None;
                }
                Some(Self::V6 {
                    network: u128::from(address) & ipv6_mask(prefix),
                    prefix,
                })
            }
        }
    }

    fn contains(self, address: IpAddr) -> bool {
        match (self, canonical_ip(address)) {
            (Self::V4 { network, prefix }, IpAddr::V4(address)) => {
                u32::from(address) & ipv4_mask(prefix) == network
            }
            (Self::V6 { network, prefix }, IpAddr::V6(address)) => {
                u128::from(address) & ipv6_mask(prefix) == network
            }
            _ => false,
        }
    }
}

fn ipv4_mask(prefix: u8) -> u32 {
    u32::MAX.checked_shl(u32::from(32 - prefix)).unwrap_or(0)
}

fn ipv6_mask(prefix: u8) -> u128 {
    u128::MAX.checked_shl(u32::from(128 - prefix)).unwrap_or(0)
}

fn canonical_ip(address: IpAddr) -> IpAddr {
    match address {
        IpAddr::V6(address) => address
            .to_ipv4_mapped()
            .map_or(IpAddr::V6(address), IpAddr::V4),
        address => address,
    }
}

fn parse_forwarded_for(headers: &HeaderMap) -> Option<Vec<IpAddr>> {
    let mut addresses = Vec::new();
    for value in headers.get_all("x-forwarded-for") {
        let value = value.to_str().ok()?;
        for address in value.split(',') {
            if addresses.len() >= MAX_FORWARDED_HOPS {
                return None;
            }
            addresses.push(canonical_ip(address.trim().parse().ok()?));
        }
    }
    (!addresses.is_empty()).then_some(addresses)
}

#[cfg(test)]
mod tests;
