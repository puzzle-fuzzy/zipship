import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@zipship/db";
import type { MembersRepository } from "./service";

export function createDrizzleMembersRepository(
  db: NodePgDatabase<typeof schema>,
): MembersRepository {
  return {
    async listMembers(organizationId) {
      const rows = await db.select({
        id: schema.members.id,
        userId: schema.members.userId,
        name: schema.users.name,
        email: schema.users.email,
        role: schema.members.role,
        joinedAt: schema.members.joinedAt,
      })
        .from(schema.members)
        .innerJoin(schema.users, eq(schema.members.userId, schema.users.id))
        .where(eq(schema.members.organizationId, organizationId))
        .orderBy(schema.members.joinedAt);

      return rows.map((r) => ({
        id: r.id,
        userId: r.userId,
        name: r.name,
        email: r.email,
        role: r.role,
        joinedAt: r.joinedAt ? r.joinedAt.toISOString() : new Date().toISOString(),
      }));
    },
  };
}
