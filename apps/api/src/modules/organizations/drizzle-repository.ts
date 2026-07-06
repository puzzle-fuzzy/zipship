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