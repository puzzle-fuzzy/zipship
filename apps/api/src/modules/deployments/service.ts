import { parseBearerToken } from "../../lib/auth";
import { CurrentReleaseLinkError, ReleaseArtifactNotFoundError } from "@zipship/storage";
import { AuditService } from "../audit/service";
import type { AuditRepository } from "../audit/service";
import { PermissionService } from "../permissions/service";
import type { AuthRepository } from "../auth/service";
import type { ProjectsRepository } from "../projects/service";
import type { OrganizationsRepository } from "../organizations/service";
import type { ReleasesRepository } from "../releases/service";
import type { Project } from "../projects/model";
import type { Release } from "../releases/model";
import {
  DeploymentFilesystemUpdateError,
  DeploymentForbiddenError,
  DeploymentProjectNotFoundError,
  DeploymentReleaseAlreadyActiveError,
  DeploymentReleaseArtifactNotFoundError,
  DeploymentReleaseNotFoundError,
  DeploymentReleaseNotReadyError,
  DeploymentReleaseNotRollbackableError,
  DeploymentServiceError,
  DeploymentUnauthorizedError,
} from "./model";
import type {
  Deployment,
  DeploymentBody,
  DeploymentHeaders,
  DeploymentList,
  DeploymentProjectParams,
  DeploymentReleaseParams,
  DeploymentResult,
} from "./model";


export interface DeploymentMutationResult {
  deployment: Deployment;
  project: Project;
  release: Release;
  previousRelease: Release | null;
}

export interface DeploymentStorage {
  createProjectSitePath(projectSlug: string): string;
  ensureReleaseArtifactReady(storagePath: string): Promise<void>;
  switchCurrentReleaseLink(input: {
    projectSitePath: string;
    releaseHash: string;
  }): Promise<void>;
}

export interface DeploymentsRepository {
  listDeploymentsForProject(projectId: string): Promise<Deployment[]>;
  publishRelease(input: {
    projectId: string;
    releaseId: string;
    operatorId: string;
    message: string | null;
    now: Date;
  }): Promise<DeploymentMutationResult | null>;
  rollbackRelease(input: {
    projectId: string;
    releaseId: string;
    operatorId: string;
    message: string | null;
    now: Date;
  }): Promise<DeploymentMutationResult | null>;
}

export interface DeploymentsServiceOptions {
  sessionRepository: Pick<AuthRepository, "findSessionByRefreshTokenHash">;
  projectsRepository: Pick<ProjectsRepository, "findProjectById">;
  membersRepository: Pick<OrganizationsRepository, "findMembership">;
  releasesRepository: Pick<ReleasesRepository, "listReleasesForProject">;
  deploymentsRepository: DeploymentsRepository;
  auditRepository: AuditRepository;
  hashRefreshToken: (token: string) => Promise<string>;
  now: () => Date;
  permissions?: PermissionService;
  storage: DeploymentStorage;
  /** Optional webhook dispatch (fires on publish/rollback). */
  webhookService?: {
    dispatch(event: string, input: { organizationId: string; payload: unknown }): Promise<void>;
  };
}

export class DeploymentsService {
  private readonly permissions: PermissionService;
  private readonly audit: AuditService;

  constructor(private readonly options: DeploymentsServiceOptions) {
    this.permissions = options.permissions ?? new PermissionService();
    this.audit = new AuditService({ repository: options.auditRepository, now: options.now });
  }

  async publish(
    headers: DeploymentHeaders,
    params: DeploymentReleaseParams,
    body: DeploymentBody,
  ): Promise<DeploymentResult | DeploymentServiceError> {
    const currentUser = await this.requireCurrentUser(headers);
    if (currentUser instanceof DeploymentServiceError) return currentUser;

    const project = await this.options.projectsRepository.findProjectById(params.projectId);
    if (!project) return new DeploymentProjectNotFoundError();

    const membership = await this.options.membersRepository.findMembership({
      organizationId: project.organizationId,
      userId: currentUser.user.id,
    });
    if (!membership) return new DeploymentForbiddenError();
    if (!this.permissions.can(membership.role, "publish_release")) return new DeploymentForbiddenError();

    const release = await this.options.releasesRepository.listReleasesForProject(params.projectId)
      .then(releases => releases.find(r => r.id === params.releaseId) ?? null);
    if (!release || release.projectId !== project.id) return new DeploymentReleaseNotFoundError();
    if (release.status !== "ready" || release.archivedAt !== null) return new DeploymentReleaseNotReadyError();

    const storageReady = await this.prepareCurrentLink(project, release);
    if (storageReady instanceof DeploymentServiceError) return storageReady;

    const result = await this.options.deploymentsRepository.publishRelease({
      projectId: project.id,
      releaseId: release.id,
      operatorId: currentUser.user.id,
      message: normalizeMessage(body.message),
      now: this.options.now(),
    });
    if (!result) return new DeploymentProjectNotFoundError();

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

    await this.options.webhookService?.dispatch("release.published", {
      organizationId: project.organizationId,
      payload: {
        projectId: project.id,
        releaseId: release.id,
        deploymentId: result.deployment.id,
      },
    });

    return result;
  }

  async list(
    headers: DeploymentHeaders,
    params: DeploymentProjectParams,
  ): Promise<DeploymentList | DeploymentServiceError> {
    const currentUser = await this.requireCurrentUser(headers);
    if (currentUser instanceof DeploymentServiceError) return currentUser;

    const project = await this.options.projectsRepository.findProjectById(params.projectId);
    if (!project) return new DeploymentProjectNotFoundError();

    const membership = await this.options.membersRepository.findMembership({
      organizationId: project.organizationId,
      userId: currentUser.user.id,
    });
    if (!membership) return new DeploymentForbiddenError();
    if (!this.permissions.can(membership.role, "view_project")) return new DeploymentForbiddenError();

    return {
      deployments: await this.options.deploymentsRepository.listDeploymentsForProject(project.id),
    };
  }

  async rollback(
    headers: DeploymentHeaders,
    params: DeploymentReleaseParams,
    body: DeploymentBody,
  ): Promise<DeploymentResult | DeploymentServiceError> {
    const currentUser = await this.requireCurrentUser(headers);
    if (currentUser instanceof DeploymentServiceError) return currentUser;

    const project = await this.options.projectsRepository.findProjectById(params.projectId);
    if (!project) return new DeploymentProjectNotFoundError();

    const membership = await this.options.membersRepository.findMembership({
      organizationId: project.organizationId,
      userId: currentUser.user.id,
    });
    if (!membership) return new DeploymentForbiddenError();
    if (!this.permissions.can(membership.role, "rollback_release")) return new DeploymentForbiddenError();

    const release = await this.options.releasesRepository.listReleasesForProject(params.projectId)
      .then(releases => releases.find(r => r.id === params.releaseId) ?? null);
    if (!release || release.projectId !== project.id) return new DeploymentReleaseNotFoundError();
    if (release.id === project.currentReleaseId) return new DeploymentReleaseAlreadyActiveError();
    if (release.status !== "ready" || release.archivedAt !== null) return new DeploymentReleaseNotRollbackableError();

    const storageReady = await this.prepareCurrentLink(project, release);
    if (storageReady instanceof DeploymentServiceError) return storageReady;

    const result = await this.options.deploymentsRepository.rollbackRelease({
      projectId: project.id,
      releaseId: release.id,
      operatorId: currentUser.user.id,
      message: normalizeMessage(body.message),
      now: this.options.now(),
    });
    if (!result) return new DeploymentProjectNotFoundError();

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

    await this.options.webhookService?.dispatch("release.rolled_back", {
      organizationId: project.organizationId,
      payload: {
        projectId: project.id,
        releaseId: release.id,
        deploymentId: result.deployment.id,
      },
    });

    return result;
  }

  private async requireCurrentUser(headers: DeploymentHeaders) {
    const refreshToken = parseBearerToken(headers.authorization);
    if (!refreshToken) return new DeploymentUnauthorizedError();

    const currentSession = await this.options.sessionRepository.findSessionByRefreshTokenHash(
      await this.options.hashRefreshToken(refreshToken),
      this.options.now(),
    );
    if (!currentSession) return new DeploymentUnauthorizedError();

    return currentSession;
  }
  private async prepareCurrentLink(project: Project, release: Release): Promise<void | DeploymentServiceError> {
    try {
      await this.options.storage.ensureReleaseArtifactReady(release.storagePath);
      await this.options.storage.switchCurrentReleaseLink({
        projectSitePath: this.options.storage.createProjectSitePath(project.slug),
        releaseHash: release.releaseHash,
      });
    } catch (error) {
      if (error instanceof ReleaseArtifactNotFoundError) return new DeploymentReleaseArtifactNotFoundError();
      if (error instanceof CurrentReleaseLinkError) return new DeploymentFilesystemUpdateError();
      return new DeploymentFilesystemUpdateError();
    }
  }
}

function normalizeMessage(message: string | null | undefined): string | null {
  const normalized = message?.trim();
  return normalized ? normalized : null;
}
