import type { Member, MemberRole } from '../../domain/members';

export type ProjectRole = MemberRole;

export interface ProjectRolePermissions {
  canUploadRelease: boolean;
  canDeployRelease: boolean;
  canManageMembers: boolean;
  canManageProject: boolean;
}

export function getProjectRolePermissions(member: Pick<Member, "role"> | null | undefined): ProjectRolePermissions {
  const role = member?.role;
  const canAdminister = role === "owner" || role === "admin";

  return {
    canUploadRelease: role === "owner" || role === "admin" || role === "developer",
    canDeployRelease: role === "owner" || role === "admin" || role === "deployer",
    canManageMembers: canAdminister,
    canManageProject: canAdminister,
  };
}
