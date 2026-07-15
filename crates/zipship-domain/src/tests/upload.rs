use super::*;

#[test]
fn validates_upload_metadata_and_state_transitions() {
    assert_eq!(
        UploadFilename::parse("  frontend.ZIP  ").unwrap().as_str(),
        "frontend.ZIP",
    );
    assert!(UploadFilename::parse("../frontend.zip").is_err());
    assert!(UploadFilename::parse("frontend.tar.gz").is_err());
    assert_eq!(UploadSize::parse(512, 1_024).unwrap().bytes(), 512);
    assert!(UploadSize::parse(0, 1_024).is_err());
    assert!(UploadSize::parse(1_025, 1_024).is_err());
    assert_eq!(
        UploadStatus::Pending.transition_to(UploadStatus::Receiving),
        Ok(UploadStatus::Receiving),
    );
    assert_eq!(
        UploadStatus::Uploaded.transition_to(UploadStatus::Processing),
        Ok(UploadStatus::Processing),
    );
    assert_eq!(
        UploadStatus::Receiving.transition_to(UploadStatus::Pending),
        Ok(UploadStatus::Pending),
    );
    assert!(
        UploadStatus::Pending
            .transition_to(UploadStatus::Completed)
            .is_err()
    );
    assert!(
        UploadStatus::Completed
            .transition_to(UploadStatus::Receiving)
            .is_err()
    );
    assert_eq!("uploaded".parse(), Ok(UploadStatus::Uploaded));
    assert!("unknown".parse::<UploadStatus>().is_err());
}
