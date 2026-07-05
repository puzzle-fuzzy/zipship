import { AuditService } from "../audit/service";
import type { AuditRepository } from "../audit/service";
import type { MemberRole } from "../permissions/model";
import { PermissionService } from "../permissions/service";
import type { Project } from "../projects/model";
import type { Release } from "../releases/model";
import {
  DeploymentForbiddenError,
  DeploymentProjectNotFoundError,
  DeploymentReleaseAlreadyActiveError,
  DeploymentReleaseNotFoundError,
  DeploymentReleaseNotReadyError,
  DeploymentReleaseNotRollbackableError,
  DeploymentServiceError,
  DeploymentUnauthorizedError,
} from "./model";
import type { AuditLog } from "../audit/model";
import type {
  Deployment,
  DeploymentBody,
  DeploymentHeaders,
  DeploymentList,
  DeploymentProjectParams,
  DeploymentReleaseParams,
  DeploymentResult,
} from "./model";

interface CurrentSession {
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
}

export interface DeploymentMutationResult {
  deployment: Deployment;
  project: Project;
  release: Release;
  previousRelease: Release | null;
}

export interface DeploymentsRepository extends AuditRepository {
  findSessionByRefreshTokenHash(refreshTokenHash: string, now: Date): Promise<CurrentSession | null>;
  findProjectById(projectId: string): Promise<Project | null>;
  findMembership(input: {
    organizationId: string;
    userId: string;
  }): Promise<{ role: MemberRole } | null>;
  findReleaseById(releaseId: string): Promise<Release | null>;
  listDeploymentsForProject(projectId: string): Promise<Deployment[]>;
  publishRelease(input: {
    projectId: string;
    releaseId: string;
    operatorId: string;
    message: string | null;
    now: Date;
  }): Promise<DeploymentMutationResult>;
  rollbackRelease(input: {
    projectId: string;
    releaseId: string;
    operatorId: string;
    message: string | null;
    now: Date;
  }): Promise<DeploymentMutationResult>;
  listAuditLogsForTest(): Promise<AuditLog[]>;
  setMemberRoleForTest(input: {
    organizationId: string;
    userId: string;
    role: MemberRole;
  }): Promise<void>;
  setReleaseStateForTest(input: {
    releaseId: string;
    status: "uploading" | "processing" | "ready" | "active" | "failed" | "archived" | "deleted";
    archived: boolean;
  }): Promise<void>;
}

export interface DeploymentsServiceOptions {
  repository: DeploymentsRepository;
  hashRefreshToken: (token: string) => Promise<string>;
  now: () => Date;
  permissions?: PermissionService;
  audit?: AuditService;
}

export class DeploymentsService {
  private readonly permissions: PermissionService;
  private readonly audit: AuditService;

  constructor(private readonly options: DeploymentsServiceOptions) {
    this.permissions = options.permissions ?? new PermissionService();
    this.audit =
      options.audit ??
      new AuditService({
        repository: options.repository,
        now: options.now,
      });
  }

  async publish(
    headers: DeploymentHeaders,
    params: DeploymentReleaseParams,
    body: DeploymentBody,
  ): Promise<DeploymentResult | DeploymentServiceError> {
    const currentUser = await this.requireCurrentUser(headers);
    if (currentUser instanceof DeploymentServiceError) return currentUser;

    const project = await this.options.repository.findProjectById(params.projectId);
    if (!project) return new DeploymentProjectNotFoundError();

    const membership = await this.options.repository.findMembership({
      organizationId: project.organizationId,
      userId: currentUser.user.id,
    });
    if (!membership) return new DeploymentForbiddenError();
    if (!this.permissions.can(membership.role, "publish_release")) return new DeploymentForbiddenError();

    const release = await this.options.repository.findReleaseById(params.releaseId);
    if (!release || release.projectId !== project.id) return new DeploymentReleaseNotFoundError();
    if (release.status !== "ready" || release.archivedAt !== null) return new DeploymentReleaseNotReadyError();

    const result = await this.options.repository.publishRelease({
      projectId: project.id,
      releaseId: release.id,
      operatorId: currentUser.user.id,
      message: normalizeMessage(body.message),
      now: this.options.now(),
    });

    await this.audit.record({
      organizationId: project.organizationId,
      projectId: project.id,
      actorId: currentUser.user.id,
      action: "release.published",
      targetType: "release",
      targetId: release.id,
      metadata: {
        releaseId: release.id,
        previousReleaseId: result.deployment.previousReleaseId,
        deploymentId: result.deployment.id,
        message: result.deployment.message,
      },
      ipAddress: null,
      userAgent: null,
    });

    return result;
  }

  async list(
    headers: DeploymentHeaders,
    params: DeploymentProjectParams,
  ): Promise<DeploymentList | DeploymentServiceError> {
    const currentUser = await this.requireCurrentUser(headers);
    if (currentUser instanceof DeploymentServiceError) return currentUser;

    const project = await this.options.repository.findProjectById(params.projectId);
    if (!project) return new DeploymentProjectNotFoundError();

    const membership = await this.options.repository.findMembership({
      organizationId: project.organizationId,
      userId: currentUser.user.id,
    });
    if (!membership) return new DeploymentForbiddenError();
    if (!this.permissions.can(membership.role, "view_project")) return new DeploymentForbiddenError();

    return {
      deployments: await this.options.repository.listDeploymentsForProject(project.id),
    };
  }

  async rollback(
    headers: DeploymentHeaders,
    params: DeploymentReleaseParams,
    body: DeploymentBody,
  ): Promise<DeploymentResult | DeploymentServiceError> {
    const currentUser = await this.requireCurrentUser(headers);
    if (currentUser instanceof DeploymentServiceError) return currentUser;

    const project = await this.options.repository.findProjectById(params.projectId);
    if (!project) return new DeploymentProjectNotFoundError();

    const membership = await this.options.repository.findMembership({
      organizationId: project.organizationId,
      userId: currentUser.user.id,
    });
    if (!membership) return new DeploymentForbiddenError();
    if (!this.permissions.can(membership.role, "rollback_release")) return new DeploymentForbiddenError();

    const release = await this.options.repository.findReleaseById(params.releaseId);
    if (!release || release.projectId !== project.id) return new DeploymentReleaseNotFoundError();
    if (release.id === project.currentReleaseId) return new DeploymentReleaseAlreadyActiveError();
    if (release.status !== "ready" || release.archivedAt !== null) return new DeploymentReleaseNotRollbackableError();

    const result = await this.options.repository.rollbackRelease({
      projectId: project.id,
      releaseId: release.id,
      operatorId: currentUser.user.id,
      message: normalizeMessage(body.message),
      now: this.options.now(),
    });

    await this.audit.record({
      organizationId: project.organizationId,
      projectId: project.id,
      actorId: currentUser.user.id,
      action: "release.rolled_back",
      targetType: "release",
      targetId: release.id,
      metadata: {
        releaseId: release.id,
        previousReleaseId: result.deployment.previousReleaseId,
        deploymentId: result.deployment.id,
        message: result.deployment.message,
      },
      ipAddress: null,
      userAgent: null,
    });

    return result;
  }

  private async requireCurrentUser(headers: DeploymentHeaders) {
    const refreshToken = parseBearerToken(headers.authorization);
    if (!refreshToken) return new DeploymentUnauthorizedError();

    const currentSession = await this.options.repository.findSessionByRefreshTokenHash(
      await this.options.hashRefreshToken(refreshToken),
      this.options.now(),
    );
    if (!currentSession) return new DeploymentUnauthorizedError();

    return currentSession;
  }
}

function normalizeMessage(message: string | null | undefined): string | null {
  const normalized = message?.trim();
  return normalized ? normalized : null;
}

function parseBearerToken(authorization: string | undefined): string | null {
  if (!authorization) return null;
  const [scheme, token] = authorization.split(" ");
  if (scheme !== "Bearer" || !token) return null;
  return token;
}
