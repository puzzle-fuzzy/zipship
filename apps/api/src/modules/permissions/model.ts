export const memberRoles = ["owner", "admin", "developer", "deployer", "viewer"] as const;

export const permissionActions = [
  "view_organization",
  "invite_member",
  "manage_member",
  "view_project",
  "create_project",
  "delete_project",
  "upload_release",
  "publish_release",
  "rollback_release",
] as const;

export type MemberRole = (typeof memberRoles)[number];
export type PermissionAction = (typeof permissionActions)[number];
