import { eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@zipship/db";
import type { ReleaseProcessingRepository } from "./service";

export function createDrizzleReleaseProcessingRepository(
  db: NodePgDatabase<typeof schema>
): ReleaseProcessingRepository {
  return {
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
        .set({ status: "failed", totalSize: input.totalSize, detectResult: input.detectResult as any })
        .where(eq(schema.releases.id, input.releaseId));

      const [task] = await db.update(schema.uploadTasks)
        .set({ status: "failed", errorMessage: input.errorCode, finishedAt: input.finishedAt })
        .where(eq(schema.uploadTasks.id, input.uploadTaskId))
        .returning();
      return toUploadTask(task);
    },

    async attachRuntimeCheck(input) {
      await db.update(schema.releases)
        .set({
          detectResult: sql`jsonb_set(${schema.releases.detectResult}, '{runtime}', ${JSON.stringify(input.runtimeCheck)}::jsonb, true)`,
        })
        .where(eq(schema.releases.id, input.releaseId));
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
