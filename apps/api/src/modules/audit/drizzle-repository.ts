import { desc, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@zipship/db";
import type { AuditLog } from "./model";
import type { AuditRepository } from "./service";

/** Map a drizzle audit_logs row to the API-facing AuditLog shape. */
function toAuditLog(log: typeof schema.auditLogs.$inferSelect): AuditLog {
  return {
    id: log.id,
    organizationId: log.organizationId,
    projectId: log.projectId,
    actorId: log.actorId,
    action: log.action,
    targetType: log.targetType,
    targetId: log.targetId,
    metadata: log.metadata as Record<string, unknown>,
    ipAddress: log.ipAddress,
    userAgent: log.userAgent,
    createdAt: log.createdAt.toISOString(),
  };
}

export function createDrizzleAuditRepository(
  db: NodePgDatabase<typeof schema>,
): AuditRepository & { listAuditLogsForTest(): Promise<AuditLog[]> } {
  return {
    async createAuditLog(input) {
      const [log] = await db.insert(schema.auditLogs).values({
        organizationId: input.organizationId,
        projectId: input.projectId ?? null,
        actorId: input.actorId ?? null,
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId ?? null,
        metadata: (input.metadata ?? {}) as any,
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
      }).returning();

      return toAuditLog(log);
    },

    async listAuditLogsForOrganization(organizationId, limit = 200) {
      const logs = await db.select().from(schema.auditLogs)
        .where(eq(schema.auditLogs.organizationId, organizationId))
        .orderBy(desc(schema.auditLogs.createdAt))
        .limit(limit);
      return logs.map(toAuditLog);
    },

    async listAuditLogsForTest() {
      const logs = await db.select().from(schema.auditLogs)
        .orderBy(schema.auditLogs.createdAt);
      return logs.map(toAuditLog);
    },
  };
}
