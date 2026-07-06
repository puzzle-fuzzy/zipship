import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@zipship/db";
import type { DeploymentsRepository, DeploymentMutationResult } from "./service";

export function createDrizzleDeploymentsRepository(
  db: NodePgDatabase<typeof schema>
): DeploymentsRepository {
  return {
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
