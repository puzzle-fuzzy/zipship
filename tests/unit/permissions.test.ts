import { describe, expect, test } from "bun:test";
import { PermissionService } from "../../apps/api/src/modules/permissions/service";

const permissions = new PermissionService();

describe("permissions", () => {
  test("allows owners and admins to manage organization members", () => {
    expect(permissions.can("owner", "invite_member")).toBe(true);
    expect(permissions.can("admin", "invite_member")).toBe(true);
    expect(permissions.can("developer", "invite_member")).toBe(false);
    expect(permissions.can("viewer", "invite_member")).toBe(false);
  });

  test("allows developers to create projects and upload releases but not publish", () => {
    expect(permissions.can("developer", "create_project")).toBe(true);
    expect(permissions.can("developer", "upload_release")).toBe(true);
    expect(permissions.can("developer", "publish_release")).toBe(false);
    expect(permissions.can("developer", "rollback_release")).toBe(false);
  });

  test("allows deployers to publish and rollback without member management", () => {
    expect(permissions.can("deployer", "publish_release")).toBe(true);
    expect(permissions.can("deployer", "rollback_release")).toBe(true);
    expect(permissions.can("deployer", "invite_member")).toBe(false);
    expect(permissions.can("deployer", "delete_project")).toBe(false);
  });

  test("allows viewers to read but not mutate", () => {
    expect(permissions.can("viewer", "view_organization")).toBe(true);
    expect(permissions.can("viewer", "view_project")).toBe(true);
    expect(permissions.can("viewer", "create_project")).toBe(false);
    expect(permissions.can("viewer", "upload_release")).toBe(false);
  });
});
