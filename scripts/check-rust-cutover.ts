import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const failures: string[] = [];

const forbiddenTrackedPrefixes = [
  "apps/api/",
  "infra/nginx/",
  "packages/config/",
  "packages/db/",
  "packages/deploy-core/",
  "packages/console-app/src/components/ui/",
  "packages/shared/",
  "packages/storage/",
  "tests/e2e/",
  "tests/integration/",
  "tests/nginx/",
  "tests/unit/",
];

const tracked = Bun.spawnSync(
  ["git", "ls-files", "--cached", "--others", "--exclude-standard"],
  { cwd: root, stdout: "pipe", stderr: "pipe" },
);
if (tracked.exitCode !== 0) {
  failures.push(`git ls-files failed: ${tracked.stderr.toString().trim()}`);
} else {
  const trackedFiles = tracked.stdout.toString().split(/\r?\n/u).filter(Boolean);
  for (const prefix of forbiddenTrackedPrefixes) {
    const matches = trackedFiles.filter((file) => file.startsWith(prefix));
    if (matches.length > 0) {
      failures.push(`${prefix} still contains legacy files: ${matches.join(", ")}`);
    }
  }
  if (trackedFiles.includes("scripts/create-test-db.ts")) {
    failures.push("scripts/create-test-db.ts still exists");
  }
  if (trackedFiles.includes("packages/console-app/components.json")) {
    failures.push("packages/console-app/components.json still exists");
  }
}

const forbiddenPackages = new Set([
  "@base-ui/react",
  "@elysia/eden",
  "@elysiajs/cors",
  "@types/nodemailer",
  "@types/pg",
  "@types/yauzl",
  "@zipship/api",
  "@zipship/config",
  "@zipship/db",
  "@zipship/deploy-core",
  "@zipship/shared",
  "@zipship/storage",
  "class-variance-authority",
  "drizzle-kit",
  "drizzle-orm",
  "elysia",
  "nodemailer",
  "pg",
  "playwright",
  "radix-ui",
  "shadcn",
  "sonner",
  "tw-animate-css",
  "yauzl",
]);

const manifestGlob = new Bun.Glob("{package.json,apps/*/package.json,packages/*/package.json}");
for await (const relativePath of manifestGlob.scan({ cwd: root, onlyFiles: true })) {
  const manifest = JSON.parse(readFileSync(join(root, relativePath), "utf8")) as Record<
    string,
    unknown
  >;
  for (const group of [
    "catalog",
    "dependencies",
    "devDependencies",
    "peerDependencies",
    "optionalDependencies",
  ]) {
    const dependencies = manifest[group];
    if (!dependencies || typeof dependencies !== "object") continue;
    for (const dependency of Object.keys(dependencies)) {
      if (forbiddenPackages.has(dependency)) {
        failures.push(`${relativePath} still declares ${dependency} in ${group}`);
      }
    }
  }
}

const forbiddenConfigurationTokens: Array<[string, string]> = [
  ["tsconfig.base.json", '"@zipship/api"'],
  ["tsconfig.base.json", '"@zipship/db"'],
  ["tsconfig.base.json", '"@zipship/deploy-core"'],
  ["tsconfig.base.json", '"@zipship/storage"'],
  [".github/workflows/ci.yml", "db:migrate"],
  [".github/workflows/ci.yml", "test:integration"],
  ["infra/docker/docker-compose.yml", "apps/api/Dockerfile"],
  ["infra/docker/docker-compose.yml", "ZIPSHIP_SITES_ROOT"],
];
for (const [relativePath, token] of forbiddenConfigurationTokens) {
  const path = join(root, relativePath);
  if (existsSync(path) && readFileSync(path, "utf8").includes(token)) {
    failures.push(`${relativePath} still contains legacy token ${token}`);
  }
}

const requiredRustPaths = [
  "crates/zipship-api/Cargo.toml",
  "crates/zipship-postgres/Cargo.toml",
  "crates/zipship-storage/Cargo.toml",
  "crates/zipship-artifact/Cargo.toml",
  "services/zipshipd/Cargo.toml",
  "services/zipship-worker/Cargo.toml",
  "crates/zipship-postgres/migrations",
];
for (const relativePath of requiredRustPaths) {
  if (!existsSync(join(root, relativePath))) {
    failures.push(`required Rust cutover path is missing: ${relativePath}`);
  }
}

const requiredOperations: Array<[string, string]> = [
  ["post", "/_api/auth/register"],
  ["post", "/_api/auth/login"],
  ["post", "/_api/auth/logout"],
  ["get", "/_api/auth/me"],
  ["post", "/_api/auth/password-resets"],
  ["post", "/_api/auth/password-resets/confirm"],
  ["get", "/_api/organizations"],
  ["get", "/_api/organizations/{organization_id}/members"],
  ["post", "/_api/organizations/{organization_id}/invitations"],
  ["post", "/_api/invitations/accept"],
  ["get", "/_api/organizations/{organization_id}/audit-logs"],
  ["post", "/_api/organizations/{organization_id}/projects"],
  ["patch", "/_api/projects/{project_id}"],
  ["post", "/_api/projects/{project_id}/uploads"],
  ["put", "/_api/uploads/{upload_id}/content"],
  ["post", "/_api/uploads/{upload_id}/complete"],
  ["get", "/_api/projects/{project_id}/releases"],
  ["post", "/_api/projects/{project_id}/releases/{release_id}/publish"],
  ["post", "/_api/projects/{project_id}/releases/{release_id}/rollback"],
  ["get", "/_api/projects/{project_id}/deployments"],
  ["post", "/_api/api-tokens"],
  ["get", "/_health/live"],
  ["get", "/_health/ready"],
];
const openApiPath = join(root, "packages/api-client/openapi/zipship.json");
if (!existsSync(openApiPath)) {
  failures.push("generated Rust OpenAPI snapshot is missing");
} else {
  const document = JSON.parse(readFileSync(openApiPath, "utf8")) as {
    paths?: Record<string, Record<string, unknown>>;
  };
  for (const [method, path] of requiredOperations) {
    if (!document.paths?.[path]?.[method]) {
      failures.push(`Rust OpenAPI is missing ${method.toUpperCase()} ${path}`);
    }
  }
}

if (failures.length > 0) {
  console.error("Rust cutover gate failed:\n");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(
  `Rust cutover gate passed: ${requiredOperations.length} API operations and ${requiredRustPaths.length} runtime boundaries verified.`,
);
