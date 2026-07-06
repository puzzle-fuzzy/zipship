import { getTableName, sql } from "drizzle-orm";
import * as schema from "@zipship/db";

export async function truncateAllTables(db: ReturnType<typeof import("./client").createTestDbClient>) {
  const entries = Object.values(schema).filter(
    (v): v is Exclude<typeof v, Function> =>
      typeof v === "object" && v !== null,
  );
  for (const entry of entries) {
    const tableName = getTableName(entry);
    await db.execute(sql`TRUNCATE TABLE ${sql.identifier(tableName)} CASCADE`);
  }
}
