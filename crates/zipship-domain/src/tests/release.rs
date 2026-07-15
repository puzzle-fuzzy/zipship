use super::*;

#[test]
fn release_activity_is_not_a_release_state() {
    assert_eq!("ready".parse(), Ok(ReleaseStatus::Ready));
    assert_eq!(
        "active".parse::<ReleaseStatus>(),
        Err(DomainError::InvalidReleaseStatus)
    );
    assert_eq!(
        ReleaseStatus::Processing.transition_to(ReleaseStatus::Ready),
        Ok(ReleaseStatus::Ready),
    );
    assert!(
        ReleaseStatus::Ready
            .transition_to(ReleaseStatus::Processing)
            .is_err()
    );
}
