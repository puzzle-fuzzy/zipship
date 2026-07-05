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
  status: "pending" | "processing";
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
  status: "processing";
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

export function createInMemoryAuthRepository(): AuthRepository &
  OrganizationsRepository &
  AuditRepository &
  ProjectsRepository &
  ReleasesRepository &
  UploadsRepository {
  const users = new Map<string, UserRecord>();
  const organizations = new Map<string, OrganizationRecord>();
  const members = new Map<string, MemberRecord>();
  const sessions = new Map<string, SessionRecord>();
  const auditLogs = new Map<string, AuditLogRecord>();
  const projects = new Map<string, ProjectRecord>();
  const uploadTasks = new Map<string, UploadTaskRecord>();
  const releases = new Map<string, ReleaseRecord>();

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
      };

      sessions.set(session.id, session);

      return {
        id: session.id,
        clientType: session.clientType,
        expiresAt: session.expiresAt.toISOString(),
      };
    },

    async findSessionByRefreshTokenHash(refreshTokenHash, now) {
      const session = Array.from(sessions.values()).find(
        (candidate) => candidate.refreshTokenHash === refreshTokenHash && candidate.expiresAt > now,
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
      return Array.from(projects.values()).some(
        (project) => project.organizationId === input.organizationId && project.slug === input.slug,
      );
    },

    async createProject(input) {
      const project: ProjectRecord = {
        id: crypto.randomUUID(),
        organizationId: input.organizationId,
        name: input.name,
        slug: input.slug,
        description: input.description,
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

    async listReleasesForProject(projectId) {
      return Array.from(releases.values())
        .filter((release) => release.projectId === projectId)
        .sort((left, right) => right.versionNumber - left.versionNumber)
        .map(toRelease);
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

    async createAuditLog(input) {
      const auditLog: AuditLogRecord = {
        id: crypto.randomUUID(),
        ...input,
      };

      auditLogs.set(auditLog.id, auditLog);

      return toAuditLog(auditLog);
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

function toProject(record: ProjectRecord): Project {
  return {
    id: record.id,
    organizationId: record.organizationId,
    name: record.name,
    slug: record.slug,
    description: record.description,
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
