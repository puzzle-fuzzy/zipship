import { and, eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@zipship/db";
import type { UploadsRepository } from "./service";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUuid(s: string): boolean {
  return UUID_RE.test(s);
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

export function createDrizzleUploadsRepository(
  db: NodePgDatabase<typeof schema>
): UploadsRepository {
  return {
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
      if (!isValidUuid(uploadTaskId)) return null;

      try {
        const rows = await db.select()
          .from(schema.uploadTasks)
          .where(eq(schema.uploadTasks.id, uploadTaskId))
          .limit(1);
        return rows[0] ? toUploadTask(rows[0]) : null;
      } catch {
        return null;
      }
    },

    async markUploadTaskProcessing(input) {
      // Look up the current upload task to get rawUploadPath and size
      const [existingTask] = await db.select()
        .from(schema.uploadTasks)
        .where(eq(schema.uploadTasks.id, input.uploadTaskId))
        .limit(1);

      // Create a release record for this upload
      const versionResult = await db
        .select({ maxVersion: sql<number>`COALESCE(MAX(${schema.releases.versionNumber}), 0)` })
        .from(schema.releases)
        .where(eq(schema.releases.projectId, input.projectId));

      const nextVersion = (versionResult[0]?.maxVersion ?? 0) + 1;

      // Placeholder values for NOT NULL columns that will be updated
      // by completeProcessedRelease or failProcessedRelease
      const placeholderHash = `pending-${input.uploadTaskId}`.replace(/-/g, "").slice(0, 32).padEnd(32, "0");

      const [release] = await db.insert(schema.releases).values({
        projectId: input.projectId,
        versionNumber: nextVersion,
        releaseHash: placeholderHash,
        fullHash: `pending:${input.uploadTaskId}`,
        status: "processing",
        storagePath: `sites/${input.projectId}/releases/pending-${input.uploadTaskId}`,
        rawUploadPath: existingTask?.rawUploadPath ?? null,
        fileCount: 0,
        totalSize: Number(existingTask?.size ?? 0),
        manifest: {},
        detectResult: {},
        createdBy: input.createdBy,
      }).returning();

      // Update the upload task to link to the release and mark as processing
      const [task] = await db.update(schema.uploadTasks)
        .set({
          status: "processing",
          releaseId: release.id,
          startedAt: input.now,
        })
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
  };
}
