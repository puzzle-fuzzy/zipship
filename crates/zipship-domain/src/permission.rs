use std::str::FromStr;

use serde::{Deserialize, Serialize};

use crate::DomainError;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MemberRole {
    Owner,
    Admin,
    Developer,
    Deployer,
    Viewer,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PermissionAction {
    ViewOrganization,
    InviteMember,
    ManageMember,
    ViewProject,
    CreateProject,
    ManageProject,
    UploadRelease,
    PublishRelease,
    RollbackRelease,
}

impl MemberRole {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Owner => "owner",
            Self::Admin => "admin",
            Self::Developer => "developer",
            Self::Deployer => "deployer",
            Self::Viewer => "viewer",
        }
    }

    pub const fn can(self, action: PermissionAction) -> bool {
        match self {
            Self::Owner | Self::Admin => true,
            Self::Developer => matches!(
                action,
                PermissionAction::ViewOrganization
                    | PermissionAction::ViewProject
                    | PermissionAction::CreateProject
                    | PermissionAction::UploadRelease
            ),
            Self::Deployer => matches!(
                action,
                PermissionAction::ViewOrganization
                    | PermissionAction::ViewProject
                    | PermissionAction::PublishRelease
                    | PermissionAction::RollbackRelease
            ),
            Self::Viewer => matches!(
                action,
                PermissionAction::ViewOrganization | PermissionAction::ViewProject
            ),
        }
    }
}

impl FromStr for MemberRole {
    type Err = DomainError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "owner" => Ok(Self::Owner),
            "admin" => Ok(Self::Admin),
            "developer" => Ok(Self::Developer),
            "deployer" => Ok(Self::Deployer),
            "viewer" => Ok(Self::Viewer),
            _ => Err(DomainError::InvalidMemberRole),
        }
    }
}
