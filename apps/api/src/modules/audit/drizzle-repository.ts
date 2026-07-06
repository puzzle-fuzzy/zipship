import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@zipship/db";
import type { AuditRepository } from "./service";

export function createDrizzleAuditRepository(
  db: NodePgDatabase<typeof schema>
): AuditRepository & { listAuditLogsForTest(): Promise<any[]> } {
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
    },

    async listAuditLogsForTest() {
      const logs = await db.select().from(schema.auditLogs)
        .orderBy(schema.auditLogs.createdAt);
      return logs.map(log => ({
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
      }));
    },
  };
}
