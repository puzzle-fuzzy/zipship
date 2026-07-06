import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@zipship/db";
import type { AuthRepository } from "./service";

export function createDrizzleAuthRepository(
  db: NodePgDatabase<typeof schema>
): AuthRepository {
  return {
    async emailExists(email) {
      const rows = await db.select({ id: schema.users.id })
        .from(schema.users)
        .where(eq(schema.users.email, email))
        .limit(1);
      return rows.length > 0;
    },

    async findUserByEmail(email) {
      const rows = await db.select()
        .from(schema.users)
        .where(eq(schema.users.email, email))
        .limit(1);
      const user = rows[0];
      return user ? { id: user.id, name: user.name, email: user.email, passwordHash: user.passwordHash } : null;
    },

    async createUserWithDefaultOrganization(input) {
      return await db.transaction(async (tx) => {
        const [user] = await tx.insert(schema.users).values({
          name: input.user.name,
          email: input.user.email,
          passwordHash: input.user.passwordHash,
        }).returning({ id: schema.users.id, name: schema.users.name, email: schema.users.email });

        const [org] = await tx.insert(schema.organizations).values({
          name: input.organization.name,
          slug: input.organization.slug,
          ownerId: user.id,
        }).returning({ id: schema.organizations.id, name: schema.organizations.name, slug: schema.organizations.slug });

        const [member] = await tx.insert(schema.members).values({
          organizationId: org.id,
          userId: user.id,
          role: input.member.role,
          status: "active",
        }).returning({ id: schema.members.id, role: schema.members.role });

        return { user, organization: org, member: { id: member.id, role: member.role as "owner" } };
      });
    },

    async createSession(input) {
      const [session] = await db.insert(schema.sessions).values({
        userId: input.userId,
        clientType: input.clientType,
        refreshTokenHash: input.refreshTokenHash,
        expiresAt: input.expiresAt,
      }).returning({ id: schema.sessions.id, clientType: schema.sessions.clientType, expiresAt: schema.sessions.expiresAt });

      return { id: session.id, clientType: session.clientType, expiresAt: session.expiresAt.toISOString() };
    },

    async findSessionByRefreshTokenHash(refreshTokenHash, now) {
      const rows = await db.select({
        session: { id: schema.sessions.id, clientType: schema.sessions.clientType, expiresAt: schema.sessions.expiresAt, revokedAt: schema.sessions.revokedAt },
        user: { id: schema.users.id, name: schema.users.name, email: schema.users.email },
      })
        .from(schema.sessions)
        .innerJoin(schema.users, eq(schema.sessions.userId, schema.users.id))
        .where(eq(schema.sessions.refreshTokenHash, refreshTokenHash))
        .limit(1);

      if (!rows[0]) return null;
      if (rows[0].session.revokedAt) return null;
      if (rows[0].session.expiresAt <= now) return null;
      return { user: rows[0].user, session: { ...rows[0].session, expiresAt: rows[0].session.expiresAt.toISOString() } };
    },

    async invalidateSession(refreshTokenHash, now) {
      await db.update(schema.sessions)
        .set({ revokedAt: now })
        .where(eq(schema.sessions.refreshTokenHash, refreshTokenHash));
    },

    async findDefaultOrganizationForUser(userId) {
      const rows = await db.select({ organizationId: schema.members.organizationId })
        .from(schema.members)
        .where(eq(schema.members.userId, userId))
        .limit(1);
      return rows[0] ? { id: rows[0].organizationId } : null;
    },
  };
}
