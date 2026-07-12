import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@zipship/db";
import type { WebhooksRepository } from "./service";

export function createDrizzleWebhooksRepository(
  db: NodePgDatabase<typeof schema>,
): WebhooksRepository {
  return {
    async createWebhook(input) {
      const [row] = await db.insert(schema.webhooks).values({
        organizationId: input.organizationId,
        url: input.url,
        secret: input.secret,
        events: input.events,
      }).returning({
        id: schema.webhooks.id,
        url: schema.webhooks.url,
        events: schema.webhooks.events,
        createdAt: schema.webhooks.createdAt,
      });
      return row;
    },

    async listWebhooksForOrganization(organizationId) {
      return db.select({
        id: schema.webhooks.id,
        url: schema.webhooks.url,
        events: schema.webhooks.events,
        createdAt: schema.webhooks.createdAt,
      })
        .from(schema.webhooks)
        .where(and(eq(schema.webhooks.organizationId, organizationId), isNull(schema.webhooks.revokedAt)))
        .orderBy(desc(schema.webhooks.createdAt));
    },

    async revokeWebhook(input) {
      const rows = await db.update(schema.webhooks)
        .set({ revokedAt: new Date() })
        .where(and(
          eq(schema.webhooks.id, input.webhookId),
          eq(schema.webhooks.organizationId, input.organizationId),
          isNull(schema.webhooks.revokedAt),
        ))
        .returning({ id: schema.webhooks.id });
      return rows.length > 0;
    },

    async listActiveByEvent(organizationId, event) {
      // events @> ARRAY[event] — PG array "contains".
      return db.select({
        url: schema.webhooks.url,
        secret: schema.webhooks.secret,
      })
        .from(schema.webhooks)
        .where(and(
          eq(schema.webhooks.organizationId, organizationId),
          isNull(schema.webhooks.revokedAt),
          sql`${schema.webhooks.events} @> ARRAY[${event}]::text[]`,
        ));
    },
  };
}
