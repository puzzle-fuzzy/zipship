import { spawnSync } from "bun";

const container = process.env.ZIPSHIP_POSTGRES_CONTAINER ?? "zipship-postgres-1";
const user = process.env.ZIPSHIP_POSTGRES_USER ?? "zipship";
const database = process.env.ZIPSHIP_TEST_DATABASE ?? "zipship_test";

function quoteLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function runPsql(sql: string) {
  return spawnSync(["docker", "exec", container, "psql", "-U", user, "-tAc", sql], {
    stdout: "pipe",
    stderr: "pipe",
  });
}

const exists = runPsql(`SELECT 1 FROM pg_database WHERE datname=${quoteLiteral(database)}`);

if (exists.exitCode !== 0) {
  process.stderr.write(exists.stderr.toString());
  process.exit(exists.exitCode);
}

if (exists.stdout.toString().trim() === "1") {
  process.exit(0);
}

const created = runPsql(`CREATE DATABASE ${quoteIdentifier(database)}`);

if (created.exitCode !== 0) {
  process.stderr.write(created.stderr.toString());
  process.exit(created.exitCode);
}
