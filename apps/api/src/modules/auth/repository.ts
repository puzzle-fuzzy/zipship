import type { AuthRepository } from "./service";
import type { AuditLog } from "../audit/model";
import type { AuditRepository } from "../audit/service";
import type { OrganizationsRepository } from "../organizations/service";
import type { MemberRole } from "../permissions/model";
import type { Project } from "../projects/model";
import type { ProjectsRepository } from "../projects/service";
import type { Release } from "../releases/model";
import type { ReleasesRepository } from "../releases/service";
import type { UploadTask } from "../uploads/model";
import type { UploadsRepository } from "../uploads/service";
import type { SitePreviewRepository } from "../site-preview/service";
import type { ReleaseProcessingRepository } from "../release-processing/service";
import type { Deployment } from "../deployments/model";
import type { DeploymentsRepository } from "../deployments/service";

interface UserRecord {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
}

interface OrganizationRecord {
  id: string;
  name: string;
  slug: string;
  ownerId: string;
}

interface MemberRecord {
  id: string;
  organizationId: string;
  userId: string;
  role: MemberRole;
  status: "active";
}

interface SessionRecord {
  id: string;
  userId: string;
  clientType: "web" | "desktop";
  refreshTokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
}

interface AuditLogRecord {
  id: string;
  organizationId: string;
  projectId: string | null;
  actorId: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  metadata: Record<string, unknown>;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: Date;
}

interface ProjectRecord {
  id: string;
  organizationId: string;
  name: string;
  slug: string;
  description: string | null;
  currentReleaseId: string | null;
  status: "active";
  visibility: "private";
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

interface UploadTaskRecord {
  id: string;
  projectId: string;
  releaseId: string | null;
  status: "pending" | "uploading" | "processing" | "completed" | "failed";
  rawUploadPath: string;
  originalFilename: string;
  size: number;
  errorMessage: string | null;
  createdBy: string;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
}

interface ReleaseRecord {
  id: string;
  projectId: string;
  versionNumber: number;
  releaseHash: string;
  fullHash: string;
  status: "uploading" | "processing" | "ready" | "active" | "failed" | "archived" | "deleted";
  storagePath: string;
  rawUploadPath: string;
  fileCount: number;
  totalSize: number;
  manifest: Record<string, unknown>;
  detectResult: Record<string, unknown>;
  createdBy: string;
  createdAt: Date;
  activatedAt: Date | null;
  archivedAt: Date | null;
}

interface DeploymentRecord {
  id: string;
  projectId: string;
  releaseId: string;
  previousReleaseId: string | null;
  action: "publish" | "rollback";
  status: "success";
  operatorId: string;
  message: string | null;
  createdAt: Date;
  finishedAt: Date | null;
}

export interface InMemoryTestRepositoryControls {
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

export function createInMemoryAuthRepository(): AuthRepository &
  OrganizationsRepository &
  AuditRepository &
  ProjectsRepository &
  ReleasesRepository &
  UploadsRepository &
  SitePreviewRepository &
  DeploymentsRepository &
  ReleaseProcessingRepository &
  InMemoryTestRepositoryControls {
  const users = new Map<string, UserRecord>();
  const organizations = new Map<string, OrganizationRecord>();
  const members = new Map<string, MemberRecord>();
  const sessions = new Map<string, SessionRecord>();
  const auditLogs = new Map<string, AuditLogRecord>();
  const projects = new Map<string, ProjectRecord>();
  const uploadTasks = new Map<string, UploadTaskRecord>();
  const releases = new Map<string, ReleaseRecord>();
  const deployments = new Map<string, DeploymentRecord>();

  return {
    async emailExists(email) {
      return users.has(email);
    },

    async findUserByEmail(email) {
      return users.get(email) ?? null;
    },

    async createUserWithDefaultOrganization(input) {
      const user: UserRecord = {
        id: crypto.randomUUID(),
        ...input.user,
      };
      const organization: OrganizationRecord = {
        id: crypto.randomUUID(),
        ownerId: user.id,
        ...input.organization,
      };
      const member: MemberRecord = {
        id: crypto.randomUUID(),
        organizationId: organization.id,
        userId: user.id,
        ...input.member,
      };

      users.set(user.email, user);
      organizations.set(organization.id, organization);
      members.set(member.id, member);

      return {
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
        },
        organization: {
          id: organization.id,
          name: organization.name,
          slug: organization.slug,
        },
        member: {
          id: member.id,
          role: input.member.role,
        },
      };
    },

    async createSession(input) {
      const session: SessionRecord = {
        id: crypto.randomUUID(),
        ...input,
        revokedAt: null,
      };

      sessions.set(session.id, session);

      return {
        id: session.id,
        clientType: session.clientType,
        expiresAt: session.expiresAt.toISOString(),
      };
    },

    async invalidateSession(refreshTokenHash, now) {
      const session = Array.from(sessions.values()).find(
        (s) => s.refreshTokenHash === refreshTokenHash,
      );
      if (session) session.revokedAt = now;
    },

    async findSessionByRefreshTokenHash(refreshTokenHash, now) {
      const session = Array.from(sessions.values()).find(
        (candidate) =>
          candidate.refreshTokenHash === refreshTokenHash &&
          !candidate.revokedAt &&
          candidate.expiresAt > now,
      );

      if (!session) return null;

      const user = Array.from(users.values()).find((candidate) => candidate.id === session.userId);

      if (!user) return null;

      return {
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
        },
        session: {
          id: session.id,
          clientType: session.clientType,
          expiresAt: session.expiresAt.toISOString(),
        },
      };
    },

    async findDefaultOrganizationForUser(userId) {
      const member = Array.from(members.values()).find((candidate) => candidate.userId === userId && candidate.status === "active");

      if (!member) return null;

      const organization = organizations.get(member.organizationId);

      if (!organization) return null;

      return {
        id: organization.id,
      };
    },

    async listOrganizationsForUser(userId) {
      return Array.from(members.values())
        .filter((member) => member.userId === userId && member.status === "active")
        .map((member) => {
          const organization = organizations.get(member.organizationId);

          if (!organization) return null;

          return {
            id: organization.id,
            name: organization.name,
            slug: organization.slug,
            role: member.role,
          };
        })
        .filter((organization): organization is NonNullable<typeof organization> => organization !== null);
    },

    async findMembership(input) {
      const member = Array.from(members.values()).find(
        (candidate) =>
          candidate.organizationId === input.organizationId && candidate.userId === input.userId && candidate.status === "active",
      );

      if (!member) return null;

      return {
        role: member.role,
      };
    },

    async projectSlugExists(input) {
      return Array.from(projects.values()).some((project) => project.slug === input.slug);
    },

    async createProject(input) {
      const project: ProjectRecord = {
        id: crypto.randomUUID(),
        organizationId: input.organizationId,
        name: input.name,
        slug: input.slug,
        description: input.description,
        currentReleaseId: null,
        status: "active",
        visibility: "private",
        createdBy: input.createdBy,
        createdAt: input.now,
        updatedAt: input.now,
      };

      projects.set(project.id, project);

      return toProject(project);
    },

    async listProjectsForOrganization(organizationId) {
      return Array.from(projects.values()).filter((project) => project.organizationId === organizationId).map(toProject);
    },

    async findProjectById(projectId) {
      const project = projects.get(projectId);

      return project ? toProject(project) : null;
    },

    async findProjectBySlug(slug) {
      const project = Array.from(projects.values()).find((candidate) => candidate.slug === slug);

      return project ? toProject(project) : null;
    },

    async updateProject(input) {
      const project = projects.get(input.projectId);
      if (!project) throw new Error("Project not found");

      if (input.name !== undefined) project.name = input.name;
      if (input.slug !== undefined) project.slug = input.slug;
      if (input.description !== undefined) project.description = input.description;
      project.updatedAt = input.now;

      return toProject(project);
    },

    async deleteProject(projectId) {
      projects.delete(projectId);
    },

    async listReleasesForProject(projectId) {
      return Array.from(releases.values())
        .filter((release) => release.projectId === projectId)
        .sort((left, right) => right.versionNumber - left.versionNumber)
        .map(toRelease);
    },

    async findPreviewableReleaseByProjectIdAndHash(input) {
      const release = Array.from(releases.values()).find(
        (candidate) =>
          candidate.projectId === input.projectId &&
          candidate.releaseHash === input.releaseHash &&
          (candidate.status === "ready" || candidate.status === "active") &&
          candidate.archivedAt === null,
      );

      return release ? toRelease(release) : null;
    },

    async createUploadTask(input) {
      const id = crypto.randomUUID();
      const uploadTask: UploadTaskRecord = {
        id,
        projectId: input.projectId,
        releaseId: null,
        status: "pending",
        rawUploadPath: `uploads/raw/${input.projectId}/${id}/${input.originalFilename}`,
        originalFilename: input.originalFilename,
        size: input.size,
        errorMessage: null,
        createdBy: input.createdBy,
        createdAt: input.now,
        startedAt: null,
        finishedAt: null,
      };

      uploadTasks.set(uploadTask.id, uploadTask);

      return toUploadTask(uploadTask);
    },

    async findUploadTaskById(uploadTaskId) {
      const uploadTask = uploadTasks.get(uploadTaskId);

      return uploadTask ? toUploadTask(uploadTask) : null;
    },

    async markUploadTaskProcessing(input) {
      const uploadTask = uploadTasks.get(input.uploadTaskId);

      if (!uploadTask) {
        throw new Error("Upload task not found");
      }

      const release: ReleaseRecord = {
        id: crypto.randomUUID(),
        projectId: input.projectId,
        versionNumber: nextReleaseVersion(input.projectId, releases),
        releaseHash: createPendingReleaseHash(input.uploadTaskId),
        fullHash: `pending:${input.uploadTaskId}`,
        status: "processing",
        storagePath: `sites/${input.projectId}/releases/pending-${input.uploadTaskId}`,
        rawUploadPath: uploadTask.rawUploadPath,
        fileCount: 0,
        totalSize: uploadTask.size,
        manifest: {},
        detectResult: {},
        createdBy: input.createdBy,
        createdAt: input.now,
        activatedAt: null,
        archivedAt: null,
      };

      releases.set(release.id, release);

      uploadTask.releaseId = release.id;
      uploadTask.status = "processing";
      uploadTask.startedAt = input.now;
      uploadTasks.set(uploadTask.id, uploadTask);

      return toUploadTask(uploadTask);
    },

    async markUploadTaskUploaded(input) {
      const uploadTask = uploadTasks.get(input.uploadTaskId);

      if (!uploadTask) {
        throw new Error("Upload task not found");
      }

      uploadTask.status = "uploading";
      uploadTask.rawUploadPath = input.rawUploadPath;
      uploadTask.size = input.size;
      uploadTasks.set(uploadTask.id, uploadTask);

      return toUploadTask(uploadTask);
    },

    async completeProcessedRelease(input) {
      const uploadTask = uploadTasks.get(input.uploadTaskId);
      const release = releases.get(input.releaseId);

      if (!uploadTask) throw new Error("Upload task not found");
      if (!release) throw new Error("Release not found");

      release.status = "ready";
      release.releaseHash = input.releaseHash;
      release.fullHash = input.fullHash;
      release.storagePath = input.storagePath;
      release.fileCount = input.fileCount;
      release.totalSize = input.totalSize;
      release.manifest = input.manifest;
      release.detectResult = input.detectResult;
      releases.set(release.id, release);

      uploadTask.status = "completed";
      uploadTask.errorMessage = null;
      uploadTask.finishedAt = input.finishedAt;
      uploadTasks.set(uploadTask.id, uploadTask);

      return toUploadTask(uploadTask);
    },

    async failProcessedRelease(input) {
      const uploadTask = uploadTasks.get(input.uploadTaskId);
      const release = releases.get(input.releaseId);

      if (!uploadTask) throw new Error("Upload task not found");
      if (!release) throw new Error("Release not found");

      release.status = "failed";
      release.detectResult = input.detectResult;
      releases.set(release.id, release);

      uploadTask.status = "failed";
      uploadTask.errorMessage = input.errorCode;
      uploadTask.finishedAt = input.finishedAt;
      uploadTasks.set(uploadTask.id, uploadTask);

      return toUploadTask(uploadTask);
    },

    async createAuditLog(input) {
      const auditLog: AuditLogRecord = {
        id: crypto.randomUUID(),
        ...input,
      };

      auditLogs.set(auditLog.id, auditLog);

      return toAuditLog(auditLog);
    },

    async listDeploymentsForProject(projectId) {
      return Array.from(deployments.values())
        .filter((deployment) => deployment.projectId === projectId)
        .sort((left, right) => {
          const timeDifference = right.createdAt.getTime() - left.createdAt.getTime();
          if (timeDifference !== 0) return timeDifference;
          return Array.from(deployments.keys()).indexOf(right.id) - Array.from(deployments.keys()).indexOf(left.id);
        })
        .map(toDeployment);
    },

    async publishRelease(input) {
      return mutateCurrentRelease({
        projects,
        releases,
        deployments,
        projectId: input.projectId,
        releaseId: input.releaseId,
        operatorId: input.operatorId,
        message: input.message,
        action: "publish",
        now: input.now,
      });
    },

    async rollbackRelease(input) {
      return mutateCurrentRelease({
        projects,
        releases,
        deployments,
        projectId: input.projectId,
        releaseId: input.releaseId,
        operatorId: input.operatorId,
        message: input.message,
        action: "rollback",
        now: input.now,
      });
    },

    async setMemberRoleForTest(input) {
      const member = Array.from(members.values()).find(
        (candidate) => candidate.organizationId === input.organizationId && candidate.userId === input.userId,
      );
      if (!member) throw new Error("Member not found");
      member.role = input.role;
      members.set(member.id, member);
    },

    async setReleaseStateForTest(input) {
      const release = releases.get(input.releaseId);
      if (!release) throw new Error("Release not found");
      release.status = input.status;
      release.archivedAt = input.archived ? new Date("2026-07-05T00:00:00.000Z") : null;
      releases.set(release.id, release);
    },

    async listAuditLogsForTest() {
      return Array.from(auditLogs.values())
        .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())
        .map(toAuditLog);
    },
  };
}

function nextReleaseVersion(projectId: string, releases: Map<string, ReleaseRecord>): number {
  const versions = Array.from(releases.values())
    .filter((release) => release.projectId === projectId)
    .map((release) => release.versionNumber);

  return versions.length > 0 ? Math.max(...versions) + 1 : 1;
}

function createPendingReleaseHash(uploadTaskId: string): string {
  return uploadTaskId.replace(/-/g, "").slice(0, 32).padEnd(32, "0");
}

function mutateCurrentRelease(input: {
  projects: Map<string, ProjectRecord>;
  releases: Map<string, ReleaseRecord>;
  deployments: Map<string, DeploymentRecord>;
  projectId: string;
  releaseId: string;
  operatorId: string;
  message: string | null;
  action: "publish" | "rollback";
  now: Date;
}) {
  const project = input.projects.get(input.projectId);
  const release = input.releases.get(input.releaseId);
  if (!project) throw new Error("Project not found");
  if (!release) throw new Error("Release not found");

  const previousReleaseId = project.currentReleaseId;
  const previousRelease = previousReleaseId ? input.releases.get(previousReleaseId) ?? null : null;

  if (previousRelease && previousRelease.id !== release.id && previousRelease.status === "active") {
    previousRelease.status = "ready";
    input.releases.set(previousRelease.id, previousRelease);
  }

  release.status = "active";
  release.activatedAt = input.now;
  input.releases.set(release.id, release);

  project.currentReleaseId = release.id;
  project.updatedAt = input.now;
  input.projects.set(project.id, project);

  const deployment: DeploymentRecord = {
    id: crypto.randomUUID(),
    projectId: project.id,
    releaseId: release.id,
    previousReleaseId,
    action: input.action,
    status: "success",
    operatorId: input.operatorId,
    message: input.message,
    createdAt: input.now,
    finishedAt: input.now,
  };
  input.deployments.set(deployment.id, deployment);

  return {
    deployment: toDeployment(deployment),
    project: toProject(project),
    release: { ...toRelease(release), previewUrl: `/_sites/${project.slug}/${release.releaseHash}/` },
    previousRelease: previousRelease
      ? { ...toRelease(previousRelease), previewUrl: `/_sites/${project.slug}/${previousRelease.releaseHash}/` }
      : null,
  };
}

function toUploadTask(record: UploadTaskRecord): UploadTask {
  return {
    id: record.id,
    projectId: record.projectId,
    releaseId: record.releaseId,
    status: record.status,
    rawUploadPath: record.rawUploadPath,
    originalFilename: record.originalFilename,
    size: record.size,
    errorMessage: record.errorMessage,
    createdBy: record.createdBy,
    createdAt: record.createdAt.toISOString(),
    startedAt: record.startedAt?.toISOString() ?? null,
    finishedAt: record.finishedAt?.toISOString() ?? null,
  };
}

function toDeployment(record: DeploymentRecord): Deployment {
  return {
    id: record.id,
    projectId: record.projectId,
    releaseId: record.releaseId,
    previousReleaseId: record.previousReleaseId,
    action: record.action,
    status: record.status,
    operatorId: record.operatorId,
    message: record.message,
    createdAt: record.createdAt.toISOString(),
    finishedAt: record.finishedAt?.toISOString() ?? null,
  };
}

function toProject(record: ProjectRecord): Project {
  return {
    id: record.id,
    organizationId: record.organizationId,
    name: record.name,
    slug: record.slug,
    description: record.description,
    currentReleaseId: record.currentReleaseId,
    status: record.status,
    visibility: record.visibility,
    createdBy: record.createdBy,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

function toRelease(record: ReleaseRecord): Release {
  return {
    id: record.id,
    projectId: record.projectId,
    versionNumber: record.versionNumber,
    releaseHash: record.releaseHash,
    previewUrl: null,
    fullHash: record.fullHash,
    status: record.status,
    storagePath: record.storagePath,
    rawUploadPath: record.rawUploadPath,
    fileCount: record.fileCount,
    totalSize: record.totalSize,
    manifest: record.manifest,
    detectResult: record.detectResult,
    createdBy: record.createdBy,
    createdAt: record.createdAt.toISOString(),
    activatedAt: record.activatedAt?.toISOString() ?? null,
    archivedAt: record.archivedAt?.toISOString() ?? null,
  };
}

function toAuditLog(record: AuditLogRecord): AuditLog {
  return {
    id: record.id,
    organizationId: record.organizationId,
    projectId: record.projectId,
    actorId: record.actorId,
    action: record.action,
    targetType: record.targetType,
    targetId: record.targetId,
    metadata: record.metadata,
    ipAddress: record.ipAddress,
    userAgent: record.userAgent,
    createdAt: record.createdAt.toISOString(),
  };
}
