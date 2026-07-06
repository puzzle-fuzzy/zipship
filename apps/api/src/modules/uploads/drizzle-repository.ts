import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@zipship/db";
import type { UploadsRepository } from "./service";

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
