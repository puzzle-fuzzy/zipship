import { eq, and, or } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@zipship/db";
import type { SitePreviewRepository } from "./service";

export function createDrizzleSitePreviewRepository(
  db: NodePgDatabase<typeof schema>
): SitePreviewRepository {
  return {
    async findProjectBySlug(slug) {
      const rows = await db.select()
        .from(schema.projects)
        .where(eq(schema.projects.slug, slug))
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
        spaFallback: p.spaFallback,
        cachePolicy: p.cachePolicy as "standard" | "aggressive",
        customDomains: p.customDomains,
        status: "active" as const,
        visibility: "private" as const,
        createdBy: p.createdBy,
        createdAt: p.createdAt.toISOString(),
        updatedAt: p.updatedAt.toISOString(),
      };
    },

    async findPreviewableReleaseByProjectIdAndHash(input) {
      const rows = await db.select()
        .from(schema.releases)
        .where(and(
          eq(schema.releases.projectId, input.projectId),
          eq(schema.releases.releaseHash, input.releaseHash),
          or(eq(schema.releases.status, "ready"), eq(schema.releases.status, "active")),
        ))
        .limit(1);

      const release = rows[0];
      if (!release) return null;

      return {
        id: release.id,
        projectId: release.projectId,
        versionNumber: release.versionNumber,
        releaseHash: release.releaseHash,
        previewUrl: null,
        fullHash: release.fullHash,
        status: release.status,
        storagePath: release.storagePath,
        rawUploadPath: release.rawUploadPath,
        fileCount: release.fileCount,
        totalSize: release.totalSize,
        manifest: release.manifest as Record<string, unknown>,
        detectResult: release.detectResult as Record<string, unknown>,
        createdBy: release.createdBy,
        createdAt: release.createdAt.toISOString(),
        activatedAt: release.activatedAt?.toISOString() ?? null,
        archivedAt: release.archivedAt?.toISOString() ?? null,
      };
    },
  };
}
