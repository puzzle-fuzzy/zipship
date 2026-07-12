import { describe, expect, it } from "vitest";
import { getProjectRolePermissions } from "../src/features/project-detail/rolePermissions";

describe("getProjectRolePermissions", () => {
  it("maps owner and admin to full project management", () => {
    for (const role of ["owner", "admin"]) {
      expect(getProjectRolePermissions({ role })).toEqual({
        canUploadRelease: true,
        canDeployRelease: true,
        canManageMembers: true,
        canManageProject: true,
      });
    }
  });

  it("keeps developer upload-only and deployer deploy-only", () => {
    expect(getProjectRolePermissions({ role: "developer" })).toEqual({
      canUploadRelease: true,
      canDeployRelease: false,
      canManageMembers: false,
      canManageProject: false,
    });
    expect(getProjectRolePermissions({ role: "deployer" })).toEqual({
      canUploadRelease: false,
      canDeployRelease: true,
      canManageMembers: false,
      canManageProject: false,
    });
  });

  it("treats viewer and missing membership as read-only", () => {
    const readOnly = {
      canUploadRelease: false,
      canDeployRelease: false,
      canManageMembers: false,
      canManageProject: false,
    };

    expect(getProjectRolePermissions({ role: "viewer" })).toEqual(readOnly);
    expect(getProjectRolePermissions(null)).toEqual(readOnly);
  });
});
