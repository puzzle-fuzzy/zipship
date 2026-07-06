import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "@zipship/db";
import { config } from "@zipship/config";

let pool: Pool | null = null;

export function getDb() {
  if (!pool) {
    pool = new Pool({ connectionString: config.databaseUrl });
  }
  return drizzle(pool, { schema });
}

export function createTestDbClient(connectionString: string) {
  const testPool = new Pool({ connectionString });
  return drizzle(testPool, { schema });
}
