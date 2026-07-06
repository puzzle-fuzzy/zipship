import { eq, and } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@zipship/db";
import type { DeploymentsRepository, DeploymentMutationResult } from "./service";

export function createDrizzleDeploymentsRepository(
  db: NodePgDatabase<typeof schema>
): DeploymentsRepository {
  return {
    async findSessionByRefreshTokenHash(refreshTokenHash, now) {
      const rows = await db.select({
        session: { id: schema.sessions.id, clientType: schema.sessions.clientType, expiresAt: schema.sessions.expiresAt },
        user: { id: schema.users.id, name: schema.users.name, email: schema.users.email },
      })
        .from(schema.sessions)
        .innerJoin(schema.users, eq(schema.sessions.userId, schema.users.id))
        .where(eq(schema.sessions.refreshTokenHash, refreshTokenHash))
        .limit(1);

      if (!rows[0] || rows[0].session.expiresAt <= now) return null;
      return { user: rows[0].user, session: { ...rows[0].session, expiresAt: rows[0].session.expiresAt.toISOString() } };
    },

    async findProjectById(projectId) {
      const rows = await db.select()
        .from(schema.projects)
        .where(eq(schema.projects.id, projectId))
        .limit(1);
      if (!rows[0]) return null;
      const p = rows[0];
      return {
        id: p.id,
        organizationId: p.organizationId,
        name: p.name,
        slug: p.slug,
        description: p.description,
        currentReleaseId: p.currentReleaseId,
        status: "active" as const,
        visibility: "private" as const,
        createdBy: p.createdBy,
        createdAt: p.createdAt.toISOString(),
        updatedAt: p.updatedAt.toISOString(),
      };
    },

    async findMembership(input) {
      const rows = await db.select({ role: schema.members.role })
        .from(schema.members)
        .where(and(
          eq(schema.members.organizationId, input.organizationId),
          eq(schema.members.userId, input.userId),
        ))
        .limit(1);
      return rows[0] ?? null;
    },

    async findReleaseById(releaseId) {
      const rows = await db.select()
        .from(schema.releases)
        .where(eq(schema.releases.id, releaseId))
        .limit(1);
      if (!rows[0]) return null;
      return toRelease(rows[0]);
    },

    async listDeploymentsForProject(projectId) {
      const rows = await db.select()
        .from(schema.deployments)
        .where(eq(schema.deployments.projectId, projectId))
        .orderBy(schema.deployments.createdAt);
      return rows.map(toDeployment).reverse();
    },

    async publishRelease(input) {
      return mutateCurrentRelease(db, { ...input, action: "publish" as const });
    },

    async rollbackRelease(input) {
      return mutateCurrentRelease(db, { ...input, action: "rollback" as const });
    },

    async createAuditLog(input) {
      const [log] = await db.insert(schema.auditLogs).values({
        organizationId: input.organizationId,
        projectId: input.projectId ?? null,
        actorId: input.actorId ?? null,
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId ?? null,
        metadata: (input.metadata ?? {}) as any,
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
      }).returning();

      return {
        id: log.id,
        organizationId: log.organizationId,
        projectId: log.projectId,
        actorId: log.actorId,
        action: log.action,
        targetType: log.targetType,
        targetId: log.targetId,
        metadata: log.metadata as Record<string, unknown>,
        ipAddress: log.ipAddress,
        userAgent: log.userAgent,
        createdAt: log.createdAt.toISOString(),
      };
    },
  };
}

async function mutateCurrentRelease(
  db: NodePgDatabase<typeof schema>,
  input: {
    projectId: string;
    releaseId: string;
    operatorId: string;
    message: string | null;
    action: "publish" | "rollback";
    now: Date;
  },
): Promise<DeploymentMutationResult> {
  return await db.transaction(async (tx) => {
    const [project] = await tx.select().from(schema.projects)
      .where(eq(schema.projects.id, input.projectId))
      .limit(1);
    if (!project) throw new Error("Project not found");

    const [release] = await tx.select().from(schema.releases)
      .where(eq(schema.releases.id, input.releaseId))
      .limit(1);
    if (!release) throw new Error("Release not found");

    const previousReleaseId = project.currentReleaseId;

    // Fetch previous release data before mutation
    let previousReleaseRecord: typeof schema.releases.$inferSelect | null = null;
    if (previousReleaseId && previousReleaseId !== input.releaseId) {
      const [prev] = await tx.select().from(schema.releases)
        .where(eq(schema.releases.id, previousReleaseId))
        .limit(1);
      if (prev) {
        await tx.update(schema.releases)
          .set({ status: "ready" })
          .where(eq(schema.releases.id, previousReleaseId));
        previousReleaseRecord = prev;
      }
    }

    // Mark new release as active
    await tx.update(schema.releases)
      .set({ status: "active", activatedAt: input.now })
      .where(eq(schema.releases.id, input.releaseId));

    // Update project's current release
    await tx.update(schema.projects)
      .set({ currentReleaseId: input.releaseId, updatedAt: input.now })
      .where(eq(schema.projects.id, input.projectId));

    // Create deployment record
    const [deployment] = await tx.insert(schema.deployments).values({
      projectId: project.id,
      releaseId: release.id,
      previousReleaseId,
      action: input.action,
      status: "success",
      operatorId: input.operatorId,
      message: input.message,
    }).returning();

    return {
      deployment: toDeployment(deployment),
      project: {
        id: project.id,
        organizationId: project.organizationId,
        name: project.name,
        slug: project.slug,
        description: project.description,
        currentReleaseId: input.releaseId,
        status: "active" as const,
        visibility: "private" as const,
        createdBy: project.createdBy,
        createdAt: project.createdAt.toISOString(),
        updatedAt: input.now.toISOString(),
      },
      release: {
        id: release.id,
        projectId: release.projectId,
        versionNumber: release.versionNumber,
        releaseHash: release.releaseHash,
        previewUrl: `/_sites/${project.slug}/${release.releaseHash}/`,
        fullHash: release.fullHash,
        status: "active" as const,
        storagePath: release.storagePath,
        rawUploadPath: release.rawUploadPath,
        fileCount: release.fileCount,
        totalSize: release.totalSize,
        manifest: release.manifest as Record<string, unknown>,
        detectResult: release.detectResult as Record<string, unknown>,
        createdBy: release.createdBy,
        createdAt: release.createdAt.toISOString(),
        activatedAt: input.now.toISOString(),
        archivedAt: null,
      },
      previousRelease: previousReleaseRecord
        ? {
            id: previousReleaseRecord.id,
            projectId: previousReleaseRecord.projectId,
            versionNumber: previousReleaseRecord.versionNumber,
            releaseHash: previousReleaseRecord.releaseHash,
            previewUrl: `/_sites/${project.slug}/${previousReleaseRecord.releaseHash}/`,
            fullHash: previousReleaseRecord.fullHash,
            status: "ready" as const,
            storagePath: previousReleaseRecord.storagePath,
            rawUploadPath: previousReleaseRecord.rawUploadPath,
            fileCount: previousReleaseRecord.fileCount,
            totalSize: previousReleaseRecord.totalSize,
            manifest: previousReleaseRecord.manifest as Record<string, unknown>,
            detectResult: previousReleaseRecord.detectResult as Record<string, unknown>,
            createdBy: previousReleaseRecord.createdBy,
            createdAt: previousReleaseRecord.createdAt.toISOString(),
            activatedAt: previousReleaseRecord.activatedAt?.toISOString() ?? null,
            archivedAt: previousReleaseRecord.archivedAt?.toISOString() ?? null,
          }
        : null,
    };
  });
}

function toRelease(record: typeof schema.releases.$inferSelect) {
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
    manifest: record.manifest as Record<string, unknown>,
    detectResult: record.detectResult as Record<string, unknown>,
    createdBy: record.createdBy,
    createdAt: record.createdAt.toISOString(),
    activatedAt: record.activatedAt?.toISOString() ?? null,
    archivedAt: record.archivedAt?.toISOString() ?? null,
  };
}

function toDeployment(record: typeof schema.deployments.$inferSelect) {
  return {
    id: record.id,
    projectId: record.projectId,
    releaseId: record.releaseId,
    previousReleaseId: record.previousReleaseId,
    action: record.action as "publish" | "rollback",
    status: "success" as const,
    operatorId: record.operatorId,
    message: record.message,
    createdAt: record.createdAt.toISOString(),
    finishedAt: record.finishedAt?.toISOString() ?? null,
  };
}
