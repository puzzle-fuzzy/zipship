import { isValidProjectSlug } from "@zipship/deploy-core";
import {
  DuplicateProjectSlugError,
  InvalidProjectInputError,
  ProjectForbiddenError,
  ProjectNotFoundError,
  ProjectServiceError,
  ProjectUnauthorizedError,
} from "./model";
import type {
  CreateProjectBody,
  CreateProjectSuccess,
  Project,
  ProjectDetail,
  ProjectDetailParams,
  ProjectHeaders,
  ProjectList,
  ProjectParams,
} from "./model";
import type { MemberRole } from "../permissions/model";
import { PermissionService } from "../permissions/service";

export interface ProjectsRepository {
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
  projectSlugExists(input: {
    organizationId: string;
    slug: string;
  }): Promise<boolean>;
  createProject(input: {
    organizationId: string;
    name: string;
    slug: string;
    description: string | null;
    createdBy: string;
    now: Date;
  }): Promise<Project>;
  listProjectsForOrganization(organizationId: string): Promise<Project[]>;
  findProjectById(projectId: string): Promise<Project | null>;
}

export interface ProjectsServiceOptions {
  repository: ProjectsRepository;
  hashRefreshToken: (token: string) => Promise<string>;
  now: () => Date;
  permissions?: PermissionService;
}

export class ProjectsService {
  private readonly permissions: PermissionService;

  constructor(private readonly options: ProjectsServiceOptions) {
    this.permissions = options.permissions ?? new PermissionService();
  }

  async create(
    headers: ProjectHeaders,
    params: ProjectParams,
    body: CreateProjectBody,
  ): Promise<CreateProjectSuccess | ProjectServiceError> {
    const currentUser = await this.requireCurrentUser(headers);

    if (currentUser instanceof ProjectServiceError) return currentUser;

    const membership = await this.options.repository.findMembership({
      organizationId: params.organizationId,
      userId: currentUser.user.id,
    });

    if (!membership) return new ProjectForbiddenError();
    if (!this.permissions.can(membership.role, "create_project")) return new ProjectForbiddenError();

    const name = normalizeName(body.name);
    const slug = normalizeSlug(body.slug);

    if (!name || !slug || !isValidProjectSlug(slug)) {
      return new InvalidProjectInputError();
    }

    const exists = await this.options.repository.projectSlugExists({
      organizationId: params.organizationId,
      slug,
    });

    if (exists) return new DuplicateProjectSlugError();

    return {
      project: await this.options.repository.createProject({
        organizationId: params.organizationId,
        name,
        slug,
        description: normalizeDescription(body.description),
        createdBy: currentUser.user.id,
        now: this.options.now(),
      }),
    };
  }

  async list(headers: ProjectHeaders, params: ProjectParams): Promise<ProjectList | ProjectServiceError> {
    const currentUser = await this.requireCurrentUser(headers);

    if (currentUser instanceof ProjectServiceError) return currentUser;

    const membership = await this.options.repository.findMembership({
      organizationId: params.organizationId,
      userId: currentUser.user.id,
    });

    if (!membership) return new ProjectForbiddenError();
    if (!this.permissions.can(membership.role, "view_project")) return new ProjectForbiddenError();

    return {
      projects: await this.options.repository.listProjectsForOrganization(params.organizationId),
    };
  }

  async get(headers: ProjectHeaders, params: ProjectDetailParams): Promise<ProjectDetail | ProjectServiceError> {
    const currentUser = await this.requireCurrentUser(headers);

    if (currentUser instanceof ProjectServiceError) return currentUser;

    const project = await this.options.repository.findProjectById(params.projectId);

    if (!project) return new ProjectNotFoundError();

    const membership = await this.options.repository.findMembership({
      organizationId: project.organizationId,
      userId: currentUser.user.id,
    });

    if (!membership) return new ProjectForbiddenError();
    if (!this.permissions.can(membership.role, "view_project")) return new ProjectForbiddenError();

    return {
      project,
    };
  }

  private async requireCurrentUser(headers: ProjectHeaders) {
    const refreshToken = parseBearerToken(headers.authorization);

    if (!refreshToken) return new ProjectUnauthorizedError();

    const currentSession = await this.options.repository.findSessionByRefreshTokenHash(
      await this.options.hashRefreshToken(refreshToken),
      this.options.now(),
    );

    if (!currentSession) return new ProjectUnauthorizedError();

    return currentSession;
  }
}

function normalizeName(name: string): string | null {
  const normalized = name.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeSlug(slug: string): string | null {
  const normalized = slug.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

function normalizeDescription(description: string | null | undefined): string | null {
  const normalized = description?.trim();
  return normalized ? normalized : null;
}

function parseBearerToken(authorization: string | undefined): string | null {
  if (!authorization) return null;

  const [scheme, token] = authorization.split(" ");

  if (scheme !== "Bearer" || !token) return null;

  return token;
}
