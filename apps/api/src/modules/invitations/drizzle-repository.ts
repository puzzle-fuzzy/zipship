import { eq, and } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@zipship/db";
import type { InvitationsRepository } from "./service";

export function createDrizzleInvitationsRepository(
  db: NodePgDatabase<typeof schema>,
): InvitationsRepository {
  return {
    async createInvitation(input) {
      const [invitation] = await db.insert(schema.invitations).values({
        organizationId: input.organizationId,
        email: input.email,
        role: input.role as any,
        invitedBy: input.invitedBy,
        tokenHash: input.tokenHash,
        expiresAt: input.expiresAt,
        status: "pending",
      }).returning({
        id: schema.invitations.id,
        email: schema.invitations.email,
        role: schema.invitations.role,
        status: schema.invitations.status,
      });

      return {
        id: invitation.id,
        email: invitation.email,
        role: invitation.role,
        status: invitation.status,
      };
    },

    async findPendingByEmail(input) {
      const rows = await db.select({ id: schema.invitations.id })
        .from(schema.invitations)
        .where(and(
          eq(schema.invitations.organizationId, input.organizationId),
          eq(schema.invitations.email, input.email),
          eq(schema.invitations.status, "pending"),
        ))
        .limit(1);
      return rows[0] ?? null;
    },

    async listInvitations(organizationId) {
      return db.select({
        id: schema.invitations.id,
        email: schema.invitations.email,
        role: schema.invitations.role,
        status: schema.invitations.status,
        createdAt: schema.invitations.createdAt,
        expiresAt: schema.invitations.expiresAt,
      })
        .from(schema.invitations)
        .where(and(
          eq(schema.invitations.organizationId, organizationId),
          eq(schema.invitations.status, "pending"),
        ))
        .orderBy(schema.invitations.createdAt);
    },

    async revokeInvitation(input) {
      const rows = await db.update(schema.invitations)
        .set({ status: "revoked" })
        .where(and(
          eq(schema.invitations.id, input.invitationId),
          eq(schema.invitations.organizationId, input.organizationId),
          eq(schema.invitations.status, "pending"),
        ))
        .returning({ id: schema.invitations.id });
      return rows.length > 0;
    },

    async findInvitationByTokenHash(tokenHash) {
      const rows = await db.select({
        id: schema.invitations.id,
        organizationId: schema.invitations.organizationId,
        email: schema.invitations.email,
        role: schema.invitations.role,
        status: schema.invitations.status,
        expiresAt: schema.invitations.expiresAt,
      })
        .from(schema.invitations)
        .where(eq(schema.invitations.tokenHash, tokenHash))
        .limit(1);
      const row = rows[0];
      if (!row) return null;
      return row;
    },

    async markInvitationStatus(input) {
      const patch: Record<string, unknown> = { status: input.status };
      if (input.acceptedAt) patch.acceptedAt = input.acceptedAt;
      await db.update(schema.invitations)
        .set(patch as any)
        .where(eq(schema.invitations.tokenHash, input.tokenHash));
    },

    async createMembership(input) {
      await db.insert(schema.members).values({
        organizationId: input.organizationId,
        userId: input.userId,
        role: input.role as any,
        status: "active",
        joinedAt: new Date(),
      }).onConflictDoNothing({
        target: [schema.members.organizationId, schema.members.userId],
      });
    },
  };
}
