use std::str::FromStr;

use super::*;

#[test]
fn enforces_job_state_transitions() {
    assert_eq!(
        JobKind::from_str("artifact.process"),
        Ok(JobKind::ArtifactProcess),
    );
    assert_eq!(JobStatus::from_str("running"), Ok(JobStatus::Running));
    assert_eq!(
        JobKind::from_str("unknown"),
        Err(DomainError::InvalidJobKind),
    );
    assert_eq!(
        JobStatus::from_str("unknown"),
        Err(DomainError::InvalidJobStatus),
    );
    assert_eq!(
        JobStatus::Queued.transition_to(JobStatus::Running),
        Ok(JobStatus::Running)
    );
    assert_eq!(
        JobStatus::Running.transition_to(JobStatus::Queued),
        Ok(JobStatus::Queued)
    );
    assert!(
        JobStatus::Succeeded
            .transition_to(JobStatus::Running)
            .is_err()
    );
}
