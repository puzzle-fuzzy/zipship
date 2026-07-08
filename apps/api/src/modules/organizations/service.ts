import { parseBearerToken } from "../../lib/auth";
import { OrganizationUnauthorizedError } from "./model";
import type { OrganizationList, OrganizationsHeaders, OrganizationServiceError } from "./model";
import type { MemberRole } from "../permissions/model";
import type { AuthRepository } from "../auth/service";
import type { AuditLog } from "../audit/model";
import type { AuditRepository } from "../audit/service";

export interface OrganizationsRepository {
  findMembership(input: {
    organizationId: string;
    userId: string;
  }): Promise<{
    role: MemberRole;
  } | null>;
  listOrganizationsForUser(userId: string): Promise<OrganizationList["organizations"]>;
  findOrganizationById(organizationId: string): Promise<{ id: string; name: string; slug: string } | null>;
}

export interface OrganizationsServiceOptions {
  organizationsRepository: OrganizationsRepository;
  sessionRepository: Pick<AuthRepository, "findSessionByRefreshTokenHash">;
  hashRefreshToken: (token: string) => Promise<string>;
  now: () => Date;
  auditRepository: AuditRepository;
}

export class OrganizationsService {
  constructor(private readonly options: OrganizationsServiceOptions) {}

  async listForCurrentUser(input: OrganizationsHeaders): Promise<OrganizationList | OrganizationServiceError> {
    const refreshToken = parseBearerToken(input.authorization);

    if (!refreshToken) {
      return new OrganizationUnauthorizedError();
    }

    const currentSession = await this.options.sessionRepository.findSessionByRefreshTokenHash(
      await this.options.hashRefreshToken(refreshToken),
      this.options.now(),
    );

    if (!currentSession) {
      return new OrganizationUnauthorizedError();
    }

    return {
      organizations: await this.options.organizationsRepository.listOrganizationsForUser(currentSession.user.id),
    };
  }

  /**
   * List audit logs for an organization. Any active member may read the org's
   * audit trail; non-members get Unauthorized.
   */
  async listAudit(
    input: OrganizationsHeaders,
    organizationId: string,
  ): Promise<{ auditLogs: AuditLog[] } | OrganizationServiceError> {
    const refreshToken = parseBearerToken(input.authorization);
    if (!refreshToken) return new OrganizationUnauthorizedError();

    const currentSession = await this.options.sessionRepository.findSessionByRefreshTokenHash(
      await this.options.hashRefreshToken(refreshToken),
      this.options.now(),
    );
    if (!currentSession) return new OrganizationUnauthorizedError();

    const membership = await this.options.organizationsRepository.findMembership({
      organizationId,
      userId: currentSession.user.id,
    });
    if (!membership) return new OrganizationUnauthorizedError();

    return {
      auditLogs: await this.options.auditRepository.listAuditLogsForOrganization(organizationId),
    };
  }
}
