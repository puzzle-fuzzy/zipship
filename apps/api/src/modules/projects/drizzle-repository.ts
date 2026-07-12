import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@zipship/db";
import type { ProjectsRepository } from "./service";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUuid(s: string): boolean {
  return UUID_RE.test(s);
}

export function createDrizzleProjectsRepository(
  db: NodePgDatabase<typeof schema>
): ProjectsRepository {
  return {
    async projectSlugExists(input) {
      const rows = await db.select({ id: schema.projects.id })
        .from(schema.projects)
        .where(eq(schema.projects.slug, input.slug))
        .limit(1);
      return rows.length > 0;
    },

    async createProject(input) {
      const [project] = await db.insert(schema.projects).values({
        organizationId: input.organizationId,
        name: input.name,
        slug: input.slug,
        description: input.description ?? null,
        createdBy: input.createdBy,
      }).returning();

      return {
        id: project.id,
        organizationId: project.organizationId,
        name: project.name,
        slug: project.slug,
        description: project.description,
        currentReleaseId: project.currentReleaseId,
        spaFallback: project.spaFallback,
        cachePolicy: project.cachePolicy as "standard" | "aggressive",
        customDomains: project.customDomains,
        status: "active" as const,
        visibility: "private" as const,
        createdBy: project.createdBy,
        createdAt: project.createdAt.toISOString(),
        updatedAt: project.updatedAt.toISOString(),
      };
    },

    async listProjectsForOrganization(organizationId) {
      if (!isValidUuid(organizationId)) return [];

      const rows = await db.select()
        .from(schema.projects)
        .where(eq(schema.projects.organizationId, organizationId));

      return rows.map(toProject);
    },

    async findProjectById(projectId) {
      if (!isValidUuid(projectId)) return null;

      try {
        const rows = await db.select()
          .from(schema.projects)
          .where(eq(schema.projects.id, projectId))
          .limit(1);

        return rows[0] ? toProject(rows[0]) : null;
      } catch {
        return null;
      }
    },

    async updateProject(input) {
      const updates: Record<string, unknown> = { updatedAt: input.now };
      if (input.name !== undefined) updates.name = input.name;
      if (input.slug !== undefined) updates.slug = input.slug;
      if (input.description !== undefined) updates.description = input.description;
      if (input.spaFallback !== undefined) updates.spaFallback = input.spaFallback;
      if (input.cachePolicy !== undefined) updates.cachePolicy = input.cachePolicy;
      if (input.customDomains !== undefined) updates.customDomains = input.customDomains;

      const [project] = await db.update(schema.projects)
        .set(updates)
        .where(eq(schema.projects.id, input.projectId))
        .returning();

      return toProject(project);
    },

    async deleteProject(projectId) {
      await db.delete(schema.projects)
        .where(eq(schema.projects.id, projectId));
    },
  };
}

function toProject(record: typeof schema.projects.$inferSelect) {
  return {
    id: record.id,
    organizationId: record.organizationId,
    name: record.name,
    slug: record.slug,
    description: record.description,
    currentReleaseId: record.currentReleaseId,
    spaFallback: record.spaFallback,
    cachePolicy: record.cachePolicy as "standard" | "aggressive",
    customDomains: record.customDomains,
    status: "active" as const,
    visibility: "private" as const,
    createdBy: record.createdBy,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}
