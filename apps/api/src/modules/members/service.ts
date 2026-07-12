import { parseBearerToken } from "../../lib/auth";
import type {
  MembersHeaders,
  MembersParams,
  MemberTargetParams,
  ChangeRoleBody,
  MemberList,
} from "./model";
import {
  MembersUnauthorizedError,
  MembersForbiddenError,
  MembersNotFoundError,
  MembersLastOwnerError,
  type MembersServiceError,
} from "./model";
import type { AuthRepository } from "../auth/service";
import { PermissionService } from "../permissions/service";
import type { MemberRole } from "../permissions/model";

export interface MembersRepository {
  listMembers(organizationId: string): Promise<Array<{
    id: string;
    userId: string;
    name: string;
    email: string;
    role: string;
    joinedAt: string;
  }>>;
  updateMemberRole(input: {
    organizationId: string;
    userId: string;
    role: string;
  }): Promise<void>;
  removeMember(input: { organizationId: string; userId: string }): Promise<void>;
  countOwners(organizationId: string): Promise<number>;
}

export interface MembersServiceOptions {
  sessionRepository: Pick<AuthRepository, "findSessionByRefreshTokenHash">;
  membersRepository: MembersRepository;
  organizationsRepository: {
    findMembership(input: { organizationId: string; userId: string }): Promise<{ role: MemberRole } | null>;
  };
  hashRefreshToken: (token: string) => Promise<string>;
  now: () => Date;
  permissions?: PermissionService;
}

export class MembersService {
  private readonly permissions: PermissionService;

  constructor(private readonly options: MembersServiceOptions) {
    this.permissions = options.permissions ?? new PermissionService();
  }

  async list(
    headers: MembersHeaders,
    params: MembersParams,
  ): Promise<MemberList | MembersServiceError> {
    const session = await this.findSession(headers);
    if (!session) return new MembersUnauthorizedError();

    const membership = await this.options.organizationsRepository.findMembership({
      organizationId: params.organizationId,
      userId: session.user.id,
    });
    if (!membership) return new MembersForbiddenError();
    if (!this.permissions.can(membership.role, "view_organization")) return new MembersForbiddenError();

    const members = await this.options.membersRepository.listMembers(params.organizationId);
    return { members };
  }

  /** Change a member's role. Owner/admin only; demoting the last owner is blocked. */
  async changeRole(
    headers: MembersHeaders,
    params: MemberTargetParams,
    body: ChangeRoleBody,
  ): Promise<{ ok: true } | MembersServiceError> {
    const session = await this.findSession(headers);
    if (!session) return new MembersUnauthorizedError();

    const actor = await this.options.organizationsRepository.findMembership({
      organizationId: params.organizationId,
      userId: session.user.id,
    });
    if (!actor) return new MembersForbiddenError();
    if (!this.permissions.can(actor.role, "manage_member")) return new MembersForbiddenError();

    const target = await this.options.organizationsRepository.findMembership({
      organizationId: params.organizationId,
      userId: params.userId,
    });
    if (!target) return new MembersNotFoundError();

    // Never strip the org of its last owner. (body.role can't be "owner".)
    if (target.role === "owner") {
      const owners = await this.options.membersRepository.countOwners(params.organizationId);
      if (owners <= 1) return new MembersLastOwnerError();
    }

    await this.options.membersRepository.updateMemberRole({
      organizationId: params.organizationId,
      userId: params.userId,
      role: body.role,
    });
    return { ok: true };
  }

  /** Remove a member. Owner/admin only; removing the last owner is blocked. */
  async remove(
    headers: MembersHeaders,
    params: MemberTargetParams,
  ): Promise<{ ok: true } | MembersServiceError> {
    const session = await this.findSession(headers);
    if (!session) return new MembersUnauthorizedError();

    const actor = await this.options.organizationsRepository.findMembership({
      organizationId: params.organizationId,
      userId: session.user.id,
    });
    if (!actor) return new MembersForbiddenError();
    if (!this.permissions.can(actor.role, "manage_member")) return new MembersForbiddenError();

    const target = await this.options.organizationsRepository.findMembership({
      organizationId: params.organizationId,
      userId: params.userId,
    });
    if (!target) return new MembersNotFoundError();

    if (target.role === "owner") {
      const owners = await this.options.membersRepository.countOwners(params.organizationId);
      if (owners <= 1) return new MembersLastOwnerError();
    }

    await this.options.membersRepository.removeMember({
      organizationId: params.organizationId,
      userId: params.userId,
    });
    return { ok: true };
  }

  private async findSession(headers: MembersHeaders) {
    const token = parseBearerToken(headers.authorization);
    if (!token) return null;

    return await this.options.sessionRepository.findSessionByRefreshTokenHash(
      await this.options.hashRefreshToken(token),
      this.options.now(),
    );
  }
}
