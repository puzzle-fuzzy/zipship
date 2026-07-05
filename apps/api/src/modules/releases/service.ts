import {
  ReleaseForbiddenError,
  ReleaseProjectNotFoundError,
  ReleaseServiceError,
  ReleaseUnauthorizedError,
} from "./model";
import type { Release, ReleaseHeaders, ReleaseList, ReleaseParams } from "./model";
import type { MemberRole } from "../permissions/model";
import { PermissionService } from "../permissions/service";
import type { Project } from "../projects/model";

export interface ReleasesRepository {
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
  findProjectById(projectId: string): Promise<Project | null>;
  findMembership(input: {
    organizationId: string;
    userId: string;
  }): Promise<{
    role: MemberRole;
  } | null>;
  listReleasesForProject(projectId: string): Promise<Release[]>;
}

export interface ReleasesServiceOptions {
  repository: ReleasesRepository;
  hashRefreshToken: (token: string) => Promise<string>;
  now: () => Date;
  permissions?: PermissionService;
}

export class ReleasesService {
  private readonly permissions: PermissionService;

  constructor(private readonly options: ReleasesServiceOptions) {
    this.permissions = options.permissions ?? new PermissionService();
  }

  async list(headers: ReleaseHeaders, params: ReleaseParams): Promise<ReleaseList | ReleaseServiceError> {
    const currentUser = await this.requireCurrentUser(headers);

    if (currentUser instanceof ReleaseServiceError) return currentUser;

    const project = await this.options.repository.findProjectById(params.projectId);

    if (!project) return new ReleaseProjectNotFoundError();

    const membership = await this.options.repository.findMembership({
      organizationId: project.organizationId,
      userId: currentUser.user.id,
    });

    if (!membership) return new ReleaseForbiddenError();
    if (!this.permissions.can(membership.role, "view_project")) return new ReleaseForbiddenError();

    return {
      releases: await this.options.repository.listReleasesForProject(project.id),
    };
  }

  private async requireCurrentUser(headers: ReleaseHeaders) {
    const refreshToken = parseBearerToken(headers.authorization);

    if (!refreshToken) return new ReleaseUnauthorizedError();

    const currentSession = await this.options.repository.findSessionByRefreshTokenHash(
      await this.options.hashRefreshToken(refreshToken),
      this.options.now(),
    );

    if (!currentSession) return new ReleaseUnauthorizedError();

    return currentSession;
  }
}

function parseBearerToken(authorization: string | undefined): string | null {
  if (!authorization) return null;

  const [scheme, token] = authorization.split(" ");

  if (scheme !== "Bearer" || !token) return null;

  return token;
}
