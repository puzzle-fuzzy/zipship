use super::*;

#[test]
fn retry_backoff_is_exponential_and_capped_at_five_minutes() {
    assert_eq!(retry_delay(1), Duration::from_secs(1));
    assert_eq!(retry_delay(2), Duration::from_secs(2));
    assert_eq!(retry_delay(5), Duration::from_secs(16));
    assert_eq!(retry_delay(10), Duration::from_secs(300));
    assert_eq!(retry_delay(u32::MAX), Duration::from_secs(300));
}

#[test]
fn validates_worker_identity_and_lease_bounds() {
    assert_eq!(
        WorkerId::parse(" worker-1"),
        Err(JobConfigurationError::InvalidWorkerId),
    );
    assert_eq!(
        WorkerId::parse("x".repeat(MAX_WORKER_ID_BYTES + 1)),
        Err(JobConfigurationError::InvalidWorkerId),
    );
    assert_eq!(
        JobLease::parse(Duration::ZERO),
        Err(JobConfigurationError::InvalidLeaseDuration),
    );
    assert_eq!(
        JobLease::parse(MAX_LEASE_DURATION + Duration::from_secs(1)),
        Err(JobConfigurationError::InvalidLeaseDuration),
    );
    assert_eq!(
        JobLease::parse(Duration::from_secs(60)).unwrap().seconds(),
        60,
    );
}
