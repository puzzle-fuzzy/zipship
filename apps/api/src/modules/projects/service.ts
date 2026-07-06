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
  UpdateProjectBody,
} from "./model";
import type { MemberRole } from "../permissions/model";
import { PermissionService } from "../permissions/service";
import type { AuthRepository } from "../auth/service";
import type { OrganizationsRepository } from "../organizations/service";

export interface ProjectsRepository {
  projectSlugExists(input: {
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
  updateProject(input: {
    projectId: string;
    name?: string;
    slug?: string;
    description?: string | null;
    now: Date;
  }): Promise<Project>;
  deleteProject(projectId: string): Promise<void>;
}

export interface ProjectsServiceOptions {
  sessionRepository: Pick<AuthRepository, "findSessionByRefreshTokenHash">;
  membersRepository: Pick<OrganizationsRepository, "findMembership">;
  projectsRepository: ProjectsRepository;
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

    const membership = await this.options.membersRepository.findMembership({
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

    const exists = await this.options.projectsRepository.projectSlugExists({
      slug,
    });

    if (exists) return new DuplicateProjectSlugError();

    return {
      project: await this.options.projectsRepository.createProject({
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

    const membership = await this.options.membersRepository.findMembership({
      organizationId: params.organizationId,
      userId: currentUser.user.id,
    });

    if (!membership) return new ProjectForbiddenError();
    if (!this.permissions.can(membership.role, "view_project")) return new ProjectForbiddenError();

    return {
      projects: await this.options.projectsRepository.listProjectsForOrganization(params.organizationId),
    };
  }

  async update(
    headers: ProjectHeaders,
    params: ProjectDetailParams,
    body: UpdateProjectBody,
  ): Promise<ProjectDetail | ProjectServiceError> {
    const currentUser = await this.requireCurrentUser(headers);
    if (currentUser instanceof ProjectServiceError) return currentUser;

    const project = await this.options.projectsRepository.findProjectById(params.projectId);
    if (!project) return new ProjectNotFoundError();

    const membership = await this.options.membersRepository.findMembership({
      organizationId: project.organizationId,
      userId: currentUser.user.id,
    });
    if (!membership) return new ProjectForbiddenError();
    // Only owner/admin can update project settings
    if (!this.permissions.can(membership.role, "delete_project")) return new ProjectForbiddenError();

    // Validate slug if provided
    if (body.slug !== undefined) {
      const slug = normalizeSlug(body.slug);
      if (!slug || !isValidProjectSlug(slug)) return new InvalidProjectInputError();
    }

    return {
      project: await this.options.projectsRepository.updateProject({
        projectId: params.projectId,
        name: body.name !== undefined ? normalizeName(body.name) ?? undefined : undefined,
        slug: body.slug !== undefined ? normalizeSlug(body.slug) ?? undefined : undefined,
        description: body.description !== undefined ? normalizeDescription(body.description) : undefined,
        now: this.options.now(),
      }),
    };
  }

  async delete(
    headers: ProjectHeaders,
    params: ProjectDetailParams,
  ): Promise<Pick<ProjectDetail, "project"> | ProjectServiceError> {
    const currentUser = await this.requireCurrentUser(headers);
    if (currentUser instanceof ProjectServiceError) return currentUser;

    const project = await this.options.projectsRepository.findProjectById(params.projectId);
    if (!project) return new ProjectNotFoundError();

    const membership = await this.options.membersRepository.findMembership({
      organizationId: project.organizationId,
      userId: currentUser.user.id,
    });
    if (!membership) return new ProjectForbiddenError();
    if (!this.permissions.can(membership.role, "delete_project")) return new ProjectForbiddenError();

    await this.options.projectsRepository.deleteProject(params.projectId);
    return { project };
  }

  async get(headers: ProjectHeaders, params: ProjectDetailParams): Promise<ProjectDetail | ProjectServiceError> {
    const currentUser = await this.requireCurrentUser(headers);

    if (currentUser instanceof ProjectServiceError) return currentUser;

    const project = await this.options.projectsRepository.findProjectById(params.projectId);

    if (!project) return new ProjectNotFoundError();

    const membership = await this.options.membersRepository.findMembership({
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

    const currentSession = await this.options.sessionRepository.findSessionByRefreshTokenHash(
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

  if (scheme.toLowerCase() !== "bearer" || !token) return null;

  return token;
}
