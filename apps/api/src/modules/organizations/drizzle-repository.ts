import { eq, and } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@zipship/db";
import type { OrganizationsRepository } from "./service";

export function createDrizzleOrganizationsRepository(
  db: NodePgDatabase<typeof schema>
): OrganizationsRepository & { setMemberRoleForTest(input: { organizationId: string; userId: string; role: string }): Promise<void> } {
  return {
    async listOrganizationsForUser(userId) {
      const rows = await db.select({
        id: schema.organizations.id,
        name: schema.organizations.name,
        slug: schema.organizations.slug,
        role: schema.members.role,
      })
        .from(schema.members)
        .innerJoin(schema.organizations, eq(schema.members.organizationId, schema.organizations.id))
        .where(eq(schema.members.userId, userId));

      return rows;
    },

    async findMembership(input: { organizationId: string; userId: string }) {
      const rows = await db.select({ role: schema.members.role })
        .from(schema.members)
        .where(and(
          eq(schema.members.organizationId, input.organizationId),
          eq(schema.members.userId, input.userId),
        ))
        .limit(1);
      return rows[0] ?? null;
    },

    async findOrganizationById(organizationId) {
      const rows = await db.select({ id: schema.organizations.id, name: schema.organizations.name, slug: schema.organizations.slug })
        .from(schema.organizations)
        .where(eq(schema.organizations.id, organizationId))
        .limit(1);
      return rows[0] ?? null;
    },

    async setMemberRoleForTest(input: { organizationId: string; userId: string; role: string }) {
      await db.update(schema.members)
        .set({ role: input.role as any })
        .where(and(
          eq(schema.members.organizationId, input.organizationId),
          eq(schema.members.userId, input.userId),
        ));
    },
  } as OrganizationsRepository & { setMemberRoleForTest(input: { organizationId: string; userId: string; role: string }): Promise<void> };
}