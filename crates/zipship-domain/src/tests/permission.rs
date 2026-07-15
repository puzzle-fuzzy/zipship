use super::*;

#[test]
fn role_capabilities_match_the_product_policy() {
    assert!(MemberRole::Admin.can(PermissionAction::ManageMember));
    assert!(MemberRole::Developer.can(PermissionAction::UploadRelease));
    assert!(!MemberRole::Developer.can(PermissionAction::PublishRelease));
    assert!(MemberRole::Deployer.can(PermissionAction::PublishRelease));
    assert!(!MemberRole::Viewer.can(PermissionAction::UploadRelease));
    assert!(MemberRole::Admin.can(PermissionAction::ManageProject));
    assert!(MemberRole::Developer.can(PermissionAction::CreateProject));
    assert!(!MemberRole::Developer.can(PermissionAction::ManageProject));
    assert!(MemberRole::Deployer.can(PermissionAction::RollbackRelease));
    assert!(!MemberRole::Viewer.can(PermissionAction::CreateProject));
    assert_eq!("deployer".parse(), Ok(MemberRole::Deployer));
}
