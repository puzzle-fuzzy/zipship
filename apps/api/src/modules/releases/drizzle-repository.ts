import { eq, and, or } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@zipship/db";
import type { ReleasesRepository } from "./service";

export function createDrizzleReleasesRepository(
  db: NodePgDatabase<typeof schema>
): ReleasesRepository {
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

    async listReleasesForProject(projectId) {
      const rows = await db.select()
        .from(schema.releases)
        .where(eq(schema.releases.projectId, projectId))
        .orderBy(schema.releases.versionNumber);

      return rows.map(toRelease).reverse();
    },

    async findReleaseById(releaseId: string) {
      const rows = await db.select()
        .from(schema.releases)
        .where(eq(schema.releases.id, releaseId))
        .limit(1);
      return rows[0] ? toRelease(rows[0]) : null;
    },

    async findPreviewableReleaseByProjectIdAndHash(input: { projectId: string; releaseHash: string }) {
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
      return toRelease(release);
    },

    async setReleaseStateForTest(input: { releaseId: string; status: string; archived: boolean }) {
      await db.update(schema.releases)
        .set({
          status: input.status as any,
          archivedAt: input.archived ? new Date() : null,
        })
        .where(eq(schema.releases.id, input.releaseId));
    },
  } as ReleasesRepository;
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
