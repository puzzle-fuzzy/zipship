import { OrganizationUnauthorizedError } from "./model";
import type { OrganizationList, OrganizationsHeaders, OrganizationServiceError } from "./model";
import type { MemberRole } from "../permissions/model";

export interface OrganizationsRepository {
  findSessionByRefreshTokenHash(
    refreshTokenHash: string,
    now: Date,
  ): Promise<{
    user: {
      id: string;
      name: string;
      email: string;
    };
    session: {
      id: string;
      clientType: "web" | "desktop";
      expiresAt: string;
    };
  } | null>;
  findMembership(input: {
    organizationId: string;
    userId: string;
  }): Promise<{
    role: MemberRole;
  } | null>;
  listOrganizationsForUser(userId: string): Promise<OrganizationList["organizations"]>;
}

export interface OrganizationsServiceOptions {
  organizationsRepository: OrganizationsRepository;
  sessionRepository: Pick<OrganizationsRepository, "findSessionByRefreshTokenHash">;
  hashRefreshToken: (token: string) => Promise<string>;
  now: () => Date;
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
}

function parseBearerToken(authorization: string | undefined): string | null {
  if (!authorization) return null;

  const [scheme, token] = authorization.split(" ");

  if (scheme !== "Bearer" || !token) return null;

  return token;
}
