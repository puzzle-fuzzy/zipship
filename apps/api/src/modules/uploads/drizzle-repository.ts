import { eq, and } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@zipship/db";
import type { UploadsRepository } from "./service";

export function createDrizzleUploadsRepository(
  db: NodePgDatabase<typeof schema>
): UploadsRepository {
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

    async createUploadTask(input) {
      const [task] = await db.insert(schema.uploadTasks).values({
        projectId: input.projectId,
        status: "pending",
        rawUploadPath: `uploads/raw/${input.projectId}/placeholder/${input.originalFilename}`,
        originalFilename: input.originalFilename,
        size: input.size,
        createdBy: input.createdBy,
      }).returning();
      return toUploadTask(task);
    },

    async findUploadTaskById(uploadTaskId) {
      const rows = await db.select()
        .from(schema.uploadTasks)
        .where(eq(schema.uploadTasks.id, uploadTaskId))
        .limit(1);
      return rows[0] ? toUploadTask(rows[0]) : null;
    },

    async markUploadTaskProcessing(input) {
      const [task] = await db.update(schema.uploadTasks)
        .set({ status: "processing", startedAt: input.now })
        .where(eq(schema.uploadTasks.id, input.uploadTaskId))
        .returning();
      return toUploadTask(task);
    },

    async markUploadTaskUploaded(input) {
      const [task] = await db.update(schema.uploadTasks)
        .set({ status: "uploading", rawUploadPath: input.rawUploadPath, size: input.size })
        .where(eq(schema.uploadTasks.id, input.uploadTaskId))
        .returning();
      return toUploadTask(task);
    },

    async completeProcessedRelease(input) {
      await db.update(schema.releases)
        .set({
          status: "ready",
          releaseHash: input.releaseHash,
          fullHash: input.fullHash,
          storagePath: input.storagePath,
          fileCount: input.fileCount,
          totalSize: input.totalSize,
          manifest: input.manifest as any,
          detectResult: input.detectResult as any,
        })
        .where(eq(schema.releases.id, input.releaseId));

      const [task] = await db.update(schema.uploadTasks)
        .set({ status: "completed", errorMessage: null, finishedAt: input.finishedAt })
        .where(eq(schema.uploadTasks.id, input.uploadTaskId))
        .returning();
      return toUploadTask(task);
    },

    async failProcessedRelease(input) {
      await db.update(schema.releases)
        .set({ status: "failed", detectResult: input.detectResult as any })
        .where(eq(schema.releases.id, input.releaseId));

      const [task] = await db.update(schema.uploadTasks)
        .set({ status: "failed", errorMessage: input.errorCode, finishedAt: input.finishedAt })
        .where(eq(schema.uploadTasks.id, input.uploadTaskId))
        .returning();
      return toUploadTask(task);
    },
  };
}

function toUploadTask(record: typeof schema.uploadTasks.$inferSelect) {
  return {
    id: record.id,
    projectId: record.projectId,
    releaseId: record.releaseId,
    status: record.status,
    rawUploadPath: record.rawUploadPath,
    originalFilename: record.originalFilename,
    size: Number(record.size),
    errorMessage: record.errorMessage,
    createdBy: record.createdBy,
    createdAt: record.createdAt.toISOString(),
    startedAt: record.startedAt?.toISOString() ?? null,
    finishedAt: record.finishedAt?.toISOString() ?? null,
  };
}
