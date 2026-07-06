import type { MembersHeaders, MembersParams, MemberList } from "./model";
import { MembersUnauthorizedError, MembersForbiddenError } from "./model";
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
  ): Promise<MemberList | MembersUnauthorizedError | MembersForbiddenError> {
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

  private async findSession(headers: MembersHeaders) {
    const token = parseBearerToken(headers.authorization);
    if (!token) return null;

    return await this.options.sessionRepository.findSessionByRefreshTokenHash(
      await this.options.hashRefreshToken(token),
      this.options.now(),
    );
  }
}

function parseBearerToken(authorization: string | undefined): string | null {
  if (!authorization) return null;
  const [scheme, token] = authorization.split(" ");
  if (scheme !== "Bearer" || !token) return null;
  return token;
}
