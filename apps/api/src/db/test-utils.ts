import { sql } from "drizzle-orm";
import * as schema from "@zipship/db";

export async function truncateAllTables(db: ReturnType<typeof import("./client").createTestDbClient>) {
  const entries = Object.values(schema).filter(
    (v) => typeof v === "object" && v !== null && "dbName" in v,
  ) as { dbName: string }[];
  for (const entry of entries) {
    await db.execute(sql`TRUNCATE TABLE ${sql.identifier(entry.dbName)} CASCADE`);
  }
}
