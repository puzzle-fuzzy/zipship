import { sql } from "drizzle-orm";

/**
 * Truncate all user tables (excluding Drizzle's migration tracking).
 *
 * Uses a PostgreSQL anonymous code block to dynamically list and truncate
 * every table in the `public` schema. This avoids depending on the Drizzle
 * schema object's iteration order or internal table-detection API, and is
 * resilient to schema changes (new/renamed/removed tables).
 */
export async function truncateAllTables(db: ReturnType<typeof import("./client").createTestDbClient>) {
  await db.execute(sql`
    DO $$
    DECLARE
      r RECORD;
    BEGIN
      FOR r IN (
        SELECT tablename
        FROM pg_tables
        WHERE schemaname = 'public'
          AND tablename != 'drizzle_migrations'
      ) LOOP
        EXECUTE 'TRUNCATE TABLE ' || quote_ident(r.tablename) || ' CASCADE';
      END LOOP;
    END $$;
  `);
}
