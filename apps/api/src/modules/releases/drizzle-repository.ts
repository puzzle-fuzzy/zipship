import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@zipship/db";
import type { ReleasesRepository } from "./service";

export function createDrizzleReleasesRepository(
  db: NodePgDatabase<typeof schema>
): ReleasesRepository & { setReleaseStateForTest(input: { releaseId: string; status: string; archived: boolean }): Promise<void> } {
  return {
    async listReleasesForProject(projectId) {
      const rows = await db.select()
        .from(schema.releases)
        .where(eq(schema.releases.projectId, projectId))
        .orderBy(schema.releases.versionNumber);

      return rows.map(toRelease).reverse();
    },

    async setReleaseStateForTest(input: { releaseId: string; status: string; archived: boolean }) {
      await db.update(schema.releases)
        .set({
          status: input.status as any,
          archivedAt: input.archived ? new Date() : null,
        })
        .where(eq(schema.releases.id, input.releaseId));
    },
  } as ReleasesRepository & { setReleaseStateForTest(input: { releaseId: string; status: string; archived: boolean }): Promise<void> };
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
