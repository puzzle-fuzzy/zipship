import {
  ReleaseForbiddenError,
  ReleaseProjectNotFoundError,
  ReleaseServiceError,
  ReleaseUnauthorizedError,
} from "./model";
import type { Release, ReleaseHeaders, ReleaseList, ReleaseParams } from "./model";
import { PermissionService } from "../permissions/service";
import type { AuthRepository } from "../auth/service";
import type { ProjectsRepository } from "../projects/service";
import type { OrganizationsRepository } from "../organizations/service";

export interface ReleasesRepository {
  listReleasesForProject(projectId: string): Promise<Release[]>;
}

export interface ReleasesServiceOptions {
  sessionRepository: Pick<AuthRepository, "findSessionByRefreshTokenHash">;
  projectsRepository: Pick<ProjectsRepository, "findProjectById">;
  membersRepository: Pick<OrganizationsRepository, "findMembership">;
  releasesRepository: ReleasesRepository;
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

    const project = await this.options.projectsRepository.findProjectById(params.projectId);

    if (!project) return new ReleaseProjectNotFoundError();

    const membership = await this.options.membersRepository.findMembership({
      organizationId: project.organizationId,
      userId: currentUser.user.id,
    });

    if (!membership) return new ReleaseForbiddenError();
    if (!this.permissions.can(membership.role, "view_project")) return new ReleaseForbiddenError();

    const releases = await this.options.releasesRepository.listReleasesForProject(project.id);

    return {
      releases: releases.map((release) => ({
        ...release,
        previewUrl:
          isPreviewableRelease(release)
            ? `/_sites/${project.slug}/${release.releaseHash}/`
            : null,
      })),
    };
  }

  private async requireCurrentUser(headers: ReleaseHeaders) {
    const refreshToken = parseBearerToken(headers.authorization);

    if (!refreshToken) return new ReleaseUnauthorizedError();

    const currentSession = await this.options.sessionRepository.findSessionByRefreshTokenHash(
      await this.options.hashRefreshToken(refreshToken),
      this.options.now(),
    );

    if (!currentSession) return new ReleaseUnauthorizedError();

    return currentSession;
  }
}

function isPreviewableRelease(release: Release): boolean {
  return (release.status === "ready" || release.status === "active") && release.archivedAt === null;
}

function parseBearerToken(authorization: string | undefined): string | null {
  if (!authorization) return null;

  const [scheme, token] = authorization.split(" ");

  if (scheme !== "Bearer" || !token) return null;

  return token;
}
