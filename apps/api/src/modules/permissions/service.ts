import type { MemberRole, PermissionAction } from "./model";

const rolePermissions: Record<MemberRole, ReadonlySet<PermissionAction>> = {
  owner: new Set([
    "view_organization",
    "invite_member",
    "manage_member",
    "view_project",
    "create_project",
    "delete_project",
    "upload_release",
    "publish_release",
    "rollback_release",
  ]),
  admin: new Set([
    "view_organization",
    "invite_member",
    "manage_member",
    "view_project",
    "create_project",
    "delete_project",
    "upload_release",
    "publish_release",
    "rollback_release",
  ]),
  developer: new Set(["view_organization", "view_project", "create_project", "upload_release"]),
  deployer: new Set(["view_organization", "view_project", "publish_release", "rollback_release"]),
  viewer: new Set(["view_organization", "view_project"]),
};

export class PermissionService {
  can(role: MemberRole, action: PermissionAction): boolean {
    return rolePermissions[role].has(action);
  }
}
