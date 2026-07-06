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
      }).returning({ id: schema.invitations.id, email: schema.invitations.email, role: schema.invitations.role, status: schema.invitations.status });

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
  };
}
