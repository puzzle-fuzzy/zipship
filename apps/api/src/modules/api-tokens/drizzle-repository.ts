import { and, desc, eq, isNull } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@zipship/db";
import type { ApiTokenRecord, ApiTokensRepository } from "./service";

export function createDrizzleApiTokensRepository(
  db: NodePgDatabase<typeof schema>,
): ApiTokensRepository {
  return {
    async createApiToken(input) {
      const [row] = await db.insert(schema.apiTokens).values({
        userId: input.userId,
        name: input.name,
        tokenHash: input.tokenHash,
      }).returning({
        id: schema.apiTokens.id,
        name: schema.apiTokens.name,
        createdAt: schema.apiTokens.createdAt,
      });
      return row;
    },

    async listApiTokensForUser(userId) {
      return db.select({
        id: schema.apiTokens.id,
        name: schema.apiTokens.name,
        createdAt: schema.apiTokens.createdAt,
        lastUsedAt: schema.apiTokens.lastUsedAt,
        revokedAt: schema.apiTokens.revokedAt,
      })
        .from(schema.apiTokens)
        .where(and(eq(schema.apiTokens.userId, userId), isNull(schema.apiTokens.revokedAt)))
        .orderBy(desc(schema.apiTokens.createdAt));
    },

    async revokeApiToken(input) {
      const rows = await db.update(schema.apiTokens)
        .set({ revokedAt: new Date() })
        .where(and(
          eq(schema.apiTokens.id, input.tokenId),
          eq(schema.apiTokens.userId, input.userId),
          isNull(schema.apiTokens.revokedAt),
        ))
        .returning({ id: schema.apiTokens.id });
      return rows.length > 0;
    },

    async findActiveApiTokenByHash(tokenHash) {
      const rows = await db.select({
        userId: schema.apiTokens.userId,
        name: schema.users.name,
        email: schema.users.email,
      })
        .from(schema.apiTokens)
        .innerJoin(schema.users, eq(schema.apiTokens.userId, schema.users.id))
        .where(and(eq(schema.apiTokens.tokenHash, tokenHash), isNull(schema.apiTokens.revokedAt)))
        .limit(1);
      return rows[0] ?? null;
    },

    async touchApiTokenLastUsed(tokenHash, now) {
      await db.update(schema.apiTokens)
        .set({ lastUsedAt: now })
        .where(eq(schema.apiTokens.tokenHash, tokenHash));
    },
  };
}

// Re-exported so the type is discoverable alongside the factory.
export type { ApiTokenRecord };
