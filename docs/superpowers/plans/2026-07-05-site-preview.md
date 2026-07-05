# Site Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an internal preview URL for ready releases so Phase 3 can return a real test address that serves the processed static artifact.

**Architecture:** Add a focused Elysia feature module under `apps/api/src/modules/site-preview` with `model.ts`, `service.ts`, and `index.ts`. Keep path safety in `packages/storage`, expose `previewUrl` from the releases API, and serve files only from `release.storagePath` for ready, non-archived releases.

**Tech Stack:** Bun, Elysia 1.4.29, TypeBox via `elysia.t`, `@elysia/eden` Treaty tests where routes are typed, direct `app.handle()` for wildcard/static body checks, `@zipship/storage`, in-memory repository.

## Global Constraints

- **测试先行是硬要求：每个任务必须先写会失败的测试，先运行并确认失败，再改实现。**
- Use the existing Elysia feature-module style: `model.ts`, `service.ts`, `index.ts`.
- Static preview errors use webpage semantics: return 404 responses, not business JSON error bodies.
- Backend business errors remain stable English codes only; do not localize backend responses.
- The preview route is internal and unauthenticated for this phase.
- The preview route must only serve files inside `release.storagePath`.
- Because the preview route uses only `:projectSlug`, project slugs must be globally unique for this phase.
- Do not implement Nginx routing, publish, rollback, deployment records, current symlinks, custom domains, or preview tokens in this plan.
- Use root env via `@zipship/config`; do not add app-local env files.
- Keep package versions in root Bun Catalogs; do not add dependencies for MIME detection.
- Do not commit generated temp folders, `.DS_Store`, `.codegraph/`, `.superpowers/`, `node_modules`, Electron `out`, or ad-hoc zip files outside committed test fixtures.
- After each task, commit only the files touched by that task.

---

## File Map

- Modify: `packages/storage/src/index.ts`
  - Add `resolveStaticAssetPath()` and `contentTypeForPath()` helpers.
- Modify: `packages/db/src/schema.ts`
  - Change project slug uniqueness from organization-scoped to global.
- Create: generated SQL file under `packages/db/drizzle/`
  - Generated migration for the project slug unique index change.
- Modify: `apps/api/src/modules/projects/service.ts`
  - Treat project slugs as globally unique.
- Modify: `apps/api/src/modules/auth/repository.ts`
  - Update in-memory slug uniqueness and later add preview lookups.
- Modify: `tests/unit/projects-routes.test.ts`
  - Prove duplicate project slugs are rejected across organizations.
- Create: `tests/unit/storage-static.test.ts`
  - Prove static path resolution, fallback, content types, and traversal denial.
- Modify: `apps/api/src/modules/releases/model.ts`
  - Add `previewUrl: string | null` to release DTO.
- Modify: `apps/api/src/modules/releases/service.ts`
  - Generate `previewUrl` for ready, non-archived releases.
- Modify: `apps/api/src/modules/auth/repository.ts`
  - Add `findProjectBySlug()` and `findReadyReleaseByProjectIdAndHash()`.
- Create: `apps/api/src/modules/site-preview/model.ts`
  - Define route params and internal result types.
- Create: `apps/api/src/modules/site-preview/service.ts`
  - Resolve project, release, and static file path.
- Create: `apps/api/src/modules/site-preview/index.ts`
  - Register Elysia routes and return file responses.
- Modify: `apps/api/src/index.ts`
  - Wire `sitePreviewModule`.
- Modify: `tests/unit/releases-routes.test.ts`
  - Assert ready releases expose `previewUrl`.
- Create: `tests/unit/site-preview-routes.test.ts`
  - Cover preview serving, fallback, failed release denial, unknown inputs, and traversal.
- Modify: `docs/02-技术架构.md`
  - Document `/_sites/:projectSlug/:releaseHash/`.
- Modify: `docs/03-测试规范与实施路线.md`
  - Mark “返回测试地址” complete in Phase 3, keeping Nginx tests in Phase 4.

---

### Task 1: Global Project Slug Uniqueness For Preview URLs

**Files:**
- Modify: `tests/unit/projects-routes.test.ts`
- Modify: `apps/api/src/modules/projects/service.ts`
- Modify: `apps/api/src/modules/auth/repository.ts`
- Modify: `packages/db/src/schema.ts`
- Create: generated SQL file under `packages/db/drizzle/`

**Interfaces:**
- Consumes:
  - `ProjectsRepository.projectSlugExists(input)`
- Produces:
  - `projectSlugExists(input: { slug: string }): Promise<boolean>`
  - Global unique index on `projects.slug`

- [ ] **Step 1: Write the failing cross-organization duplicate slug test**

Append this test to `tests/unit/projects-routes.test.ts`:

```ts
test("rejects duplicate project slugs across organizations for preview URLs", async () => {
  const api = treaty(createApp());

  await api._api.auth.register.post({
    name: "Ada Lovelace",
    email: "ada@example.com",
    password: "correct-horse-battery",
  });
  const adaLogin = await api._api.auth.login.post({
    email: "ada@example.com",
    password: "correct-horse-battery",
    clientType: "web",
  });
  const adaToken = adaLogin.data?.session.refreshToken ?? "";
  const adaOrganizations = await api._api.organizations.get({
    headers: { authorization: `Bearer ${adaToken}` },
  });
  const adaOrganizationId = adaOrganizations.data?.organizations[0]?.id ?? "";

  const first = await api._api.organizations({ organizationId: adaOrganizationId }).projects.post(
    {
      name: "Marketing Site",
      slug: "marketing-site",
      description: null,
    },
    {
      headers: { authorization: `Bearer ${adaToken}` },
    },
  );
  expect(first.status).toBe(201);

  await api._api.auth.register.post({
    name: "Grace Hopper",
    email: "grace@example.com",
    password: "correct-horse-battery",
  });
  const graceLogin = await api._api.auth.login.post({
    email: "grace@example.com",
    password: "correct-horse-battery",
    clientType: "web",
  });
  const graceToken = graceLogin.data?.session.refreshToken ?? "";
  const graceOrganizations = await api._api.organizations.get({
    headers: { authorization: `Bearer ${graceToken}` },
  });
  const graceOrganizationId = graceOrganizations.data?.organizations[0]?.id ?? "";

  const duplicate = await api._api.organizations({ organizationId: graceOrganizationId }).projects.post(
    {
      name: "Other Marketing Site",
      slug: "marketing-site",
      description: null,
    },
    {
      headers: { authorization: `Bearer ${graceToken}` },
    },
  );

  expect(duplicate.status).toBe(400);
  expect((duplicate.error?.value as unknown)).toEqual({
    code: "DUPLICATE_PROJECT_SLUG",
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
bun test tests/unit/projects-routes.test.ts --test-name-pattern "duplicate project slugs across organizations"
```

Expected: FAIL because the in-memory repository currently checks slug uniqueness per organization.

- [ ] **Step 3: Change the repository interface and service call**

Modify `apps/api/src/modules/projects/service.ts`.

Change the repository interface:

```ts
  projectSlugExists(input: {
    slug: string;
  }): Promise<boolean>;
```

Change the call in `ProjectsService.create()`:

```ts
const exists = await this.options.repository.projectSlugExists({
  slug,
});
```

- [ ] **Step 4: Change in-memory repository slug lookup**

Modify `apps/api/src/modules/auth/repository.ts`.

Replace `projectSlugExists` with:

```ts
async projectSlugExists(input) {
  return Array.from(projects.values()).some((project) => project.slug === input.slug);
},
```

- [ ] **Step 5: Change database schema unique index**

Modify `packages/db/src/schema.ts`.

Replace:

```ts
uniqueIndex("projects_organization_slug_unique").on(table.organizationId, table.slug),
```

with:

```ts
uniqueIndex("projects_slug_unique").on(table.slug),
```

Keep `index("projects_organization_id_idx").on(table.organizationId)`.

- [ ] **Step 6: Generate migration**

Run:

```bash
bun run db:generate
```

Expected: drizzle generates a migration that drops `projects_organization_slug_unique` and creates `projects_slug_unique`.

- [ ] **Step 7: Run tests and typecheck**

Run:

```bash
bun test tests/unit/projects-routes.test.ts
bun run --filter @zipship/api typecheck
bun run --filter @zipship/db typecheck
```

Expected: all commands exit with code 0.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/modules/projects/service.ts apps/api/src/modules/auth/repository.ts packages/db/src/schema.ts packages/db/drizzle tests/unit/projects-routes.test.ts
git commit -m "feat: require global project slugs"
```

---

### Task 2: Release Preview URL DTO

**Files:**
- Modify: `tests/unit/releases-routes.test.ts`
- Modify: `apps/api/src/modules/releases/model.ts`
- Modify: `apps/api/src/modules/releases/service.ts`

**Interfaces:**
- Consumes:
  - `Release.status`
  - `Release.archivedAt`
  - `Project.slug`
- Produces:
  - `Release.previewUrl: string | null`
  - Ready, non-archived release preview URL: `/_sites/{project.slug}/{release.releaseHash}/`

- [ ] **Step 1: Write the failing release-list previewUrl test**

In `tests/unit/releases-routes.test.ts`, inside `lists project releases created by completed upload tasks`, after `expect(release.status).toBe("ready");`, add:

```ts
expect(release.previewUrl).toBe(`/_sites/${project.slug}/${release.releaseHash}/`);
```

In the same test, keep the existing file-system assertions for `release.storagePath`.

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
bun test tests/unit/releases-routes.test.ts
```

Expected: FAIL because `previewUrl` is not present on the release DTO.

- [ ] **Step 3: Add previewUrl to the release model**

Modify `apps/api/src/modules/releases/model.ts` and add `previewUrl` to `releaseModel` after `releaseHash`:

```ts
  previewUrl: t.Nullable(t.String()),
```

The release model should include:

```ts
export const releaseModel = t.Object({
  id: t.String(),
  projectId: t.String(),
  versionNumber: t.Number(),
  releaseHash: t.String(),
  previewUrl: t.Nullable(t.String()),
  fullHash: t.String(),
  status: t.Union([
    t.Literal("uploading"),
    t.Literal("processing"),
    t.Literal("ready"),
    t.Literal("active"),
    t.Literal("failed"),
    t.Literal("archived"),
    t.Literal("deleted"),
  ]),
  storagePath: t.String(),
  rawUploadPath: t.Nullable(t.String()),
  fileCount: t.Number(),
  totalSize: t.Number(),
  manifest: t.Record(t.String(), t.Unknown()),
  detectResult: t.Record(t.String(), t.Unknown()),
  createdBy: t.String(),
  createdAt: t.String(),
  activatedAt: t.Nullable(t.String()),
  archivedAt: t.Nullable(t.String()),
});
```

- [ ] **Step 4: Generate previewUrl in ReleasesService**

Modify `apps/api/src/modules/releases/service.ts`. Replace the return block:

```ts
return {
  releases: await this.options.repository.listReleasesForProject(project.id),
};
```

with:

```ts
const releases = await this.options.repository.listReleasesForProject(project.id);

return {
  releases: releases.map((release) => ({
    ...release,
    previewUrl:
      release.status === "ready" && release.archivedAt === null
        ? `/_sites/${project.slug}/${release.releaseHash}/`
        : null,
  })),
};
```

Do not mutate repository records; `previewUrl` is an API DTO field.

- [ ] **Step 5: Run tests and typecheck**

Run:

```bash
bun test tests/unit/releases-routes.test.ts
bun run --filter @zipship/api typecheck
```

Expected: both commands exit with code 0.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/releases/model.ts apps/api/src/modules/releases/service.ts tests/unit/releases-routes.test.ts
git commit -m "feat: expose release preview urls"
```

---

### Task 3: Safe Static Asset Path Resolution

**Files:**
- Modify: `packages/storage/src/index.ts`
- Create: `tests/unit/storage-static.test.ts`

**Interfaces:**
- Produces:
  - `resolveStaticAssetPath(input: { rootDir: string; requestPath: string }): Promise<{ kind: "file"; absolutePath: string } | { kind: "not-found" }>`
  - `contentTypeForPath(absolutePath: string): string`

- [ ] **Step 1: Write failing storage helper tests**

Create `tests/unit/storage-static.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { contentTypeForPath, resolveStaticAssetPath } from "../../packages/storage/src/index";

function createTempRoot() {
  return mkdtempSync(join(tmpdir(), "zipship-storage-static-"));
}

describe("resolveStaticAssetPath", () => {
  test("resolves files inside the static root", async () => {
    const root = createTempRoot();
    try {
      mkdirSync(join(root, "assets"), { recursive: true });
      writeFileSync(join(root, "index.html"), "<script src=\"./assets/index.js\"></script>");
      writeFileSync(join(root, "assets/index.js"), "console.log('zipship')");

      const resolved = await resolveStaticAssetPath({
        rootDir: root,
        requestPath: "assets/index.js",
      });

      expect(resolved).toEqual({
        kind: "file",
        absolutePath: join(root, "assets/index.js"),
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("falls back to index.html for unknown SPA paths", async () => {
    const root = createTempRoot();
    try {
      writeFileSync(join(root, "index.html"), "<main>app</main>");

      const resolved = await resolveStaticAssetPath({
        rootDir: root,
        requestPath: "dashboard/settings",
      });

      expect(resolved).toEqual({
        kind: "file",
        absolutePath: join(root, "index.html"),
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("rejects traversal and absolute paths", async () => {
    const root = createTempRoot();
    try {
      writeFileSync(join(root, "index.html"), "<main>app</main>");

      await expect(resolveStaticAssetPath({ rootDir: root, requestPath: "../secret.txt" })).resolves.toEqual({ kind: "not-found" });
      await expect(resolveStaticAssetPath({ rootDir: root, requestPath: "%2e%2e/secret.txt" })).resolves.toEqual({ kind: "not-found" });
      await expect(resolveStaticAssetPath({ rootDir: root, requestPath: "..%5Csecret.txt" })).resolves.toEqual({ kind: "not-found" });
      await expect(resolveStaticAssetPath({ rootDir: root, requestPath: "/etc/passwd" })).resolves.toEqual({ kind: "not-found" });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("contentTypeForPath", () => {
  test("maps common static file extensions", () => {
    expect(contentTypeForPath("index.html")).toBe("text/html; charset=utf-8");
    expect(contentTypeForPath("index.js")).toBe("text/javascript; charset=utf-8");
    expect(contentTypeForPath("style.css")).toBe("text/css; charset=utf-8");
    expect(contentTypeForPath("data.json")).toBe("application/json; charset=utf-8");
    expect(contentTypeForPath("image.png")).toBe("image/png");
    expect(contentTypeForPath("unknown.bin")).toBe("application/octet-stream");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
bun test tests/unit/storage-static.test.ts
```

Expected: FAIL because `resolveStaticAssetPath` and `contentTypeForPath` are not exported yet.

- [ ] **Step 3: Add storage helper signatures**

Modify imports in `packages/storage/src/index.ts`:

```ts
import { cp, mkdir, rm, stat } from "fs/promises";
import { dirname, extname, resolve, sep } from "path";
```

Replace existing `join` import usages by importing `join` too:

```ts
import { dirname, extname, join, resolve, sep } from "path";
```

Add these helpers after `copyDirectoryContents`:

```ts
export type StaticAssetResolution =
  | {
      kind: "file";
      absolutePath: string;
    }
  | {
      kind: "not-found";
    };

export async function resolveStaticAssetPath(input: {
  rootDir: string;
  requestPath: string;
}): Promise<StaticAssetResolution> {
  const root = resolve(input.rootDir);
  const decodedPath = safeDecodePath(input.requestPath);

  if (decodedPath === null || isDangerousStaticPath(decodedPath)) {
    return { kind: "not-found" };
  }

  const cleanPath = decodedPath.replace(/^\/+/, "");
  const candidate = resolve(root, cleanPath || "index.html");

  if (!isPathInside(root, candidate)) {
    return { kind: "not-found" };
  }

  const filePath = await resolveFileOrFallback(root, candidate);

  if (!filePath) return { kind: "not-found" };

  return {
    kind: "file",
    absolutePath: filePath,
  };
}

export function contentTypeForPath(absolutePath: string): string {
  switch (extname(absolutePath).toLowerCase()) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".ico":
      return "image/x-icon";
    default:
      return "application/octet-stream";
  }
}

function safeDecodePath(requestPath: string): string | null {
  try {
    return decodeURIComponent(requestPath);
  } catch {
    return null;
  }
}

function isDangerousStaticPath(requestPath: string): boolean {
  if (requestPath.includes("\0")) return true;
  if (requestPath.includes("\\")) return true;
  if (requestPath.startsWith("/")) return true;
  if (/^[a-zA-Z]:/.test(requestPath)) return true;

  return requestPath.split("/").some((part) => part === "..");
}

function isPathInside(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(root.endsWith(sep) ? root : root + sep);
}

async function resolveFileOrFallback(root: string, candidate: string): Promise<string | null> {
  const candidateFile = await statFile(candidate);

  if (candidateFile === "file") return candidate;
  if (candidateFile === "directory") {
    const indexPath = resolve(candidate, "index.html");
    return (await statFile(indexPath)) === "file" && isPathInside(root, indexPath) ? indexPath : null;
  }

  const fallback = resolve(root, "index.html");
  return (await statFile(fallback)) === "file" ? fallback : null;
}

async function statFile(absolutePath: string): Promise<"file" | "directory" | "missing"> {
  try {
    const result = await stat(absolutePath);
    if (result.isFile()) return "file";
    if (result.isDirectory()) return "directory";
    return "missing";
  } catch {
    return "missing";
  }
}
```

- [ ] **Step 4: Run storage typecheck**

Run:

```bash
bun test tests/unit/storage-static.test.ts
bun run --filter @zipship/storage typecheck
```

Expected: both commands exit with code 0.

- [ ] **Step 5: Commit**

```bash
git add packages/storage/src/index.ts tests/unit/storage-static.test.ts
git commit -m "feat: add static asset path resolver"
```

---

### Task 4: Site Preview Module And Happy Paths

**Files:**
- Create: `apps/api/src/modules/site-preview/model.ts`
- Create: `apps/api/src/modules/site-preview/service.ts`
- Create: `apps/api/src/modules/site-preview/index.ts`
- Modify: `apps/api/src/index.ts`
- Modify: `apps/api/src/modules/auth/repository.ts`
- Modify: `tests/unit/site-preview-routes.test.ts`

**Interfaces:**
- Consumes:
  - `resolveStaticAssetPath()`
  - `contentTypeForPath()`
  - `findProjectBySlug(slug: string)`
  - `findReadyReleaseByProjectIdAndHash(input)`
- Produces:
  - `sitePreviewModule(options)`
  - `GET /_sites/:projectSlug/:releaseHash/`
  - `GET /_sites/:projectSlug/:releaseHash/*`

- [ ] **Step 1: Create failing happy-path route tests**

Create `tests/unit/site-preview-routes.test.ts`:

```ts
import { treaty } from "@elysia/eden";
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createApp } from "../../apps/api/src/index";

function createTempStorageRoot() {
  return mkdtempSync(join(tmpdir(), "zipship-api-site-preview-"));
}

async function registerLoginAndCreateProject(api = treaty(createApp())) {
  await api._api.auth.register.post({
    name: "Ada Lovelace",
    email: "ada@example.com",
    password: "correct-horse-battery",
  });
  const login = await api._api.auth.login.post({
    email: "ada@example.com",
    password: "correct-horse-battery",
    clientType: "web",
  });
  const refreshToken = login.data?.session.refreshToken ?? "";
  const organizations = await api._api.organizations.get({
    headers: {
      authorization: `Bearer ${refreshToken}`,
    },
  });
  const organizationId = organizations.data?.organizations[0]?.id ?? "";
  const created = await api._api.organizations({ organizationId }).projects.post(
    {
      name: "Marketing Site",
      slug: "marketing-site",
      description: "Launch pages",
    },
    {
      headers: {
        authorization: `Bearer ${refreshToken}`,
      },
    },
  );
  const project = created.data?.project;

  if (!project) {
    throw new Error("Project creation unexpectedly returned no project");
  }

  return {
    api,
    refreshToken,
    project,
  };
}

async function createReadyRelease(storageRoot: string) {
  const app = createApp({ storageRoot });
  const api = treaty(app);
  const { refreshToken, project } = await registerLoginAndCreateProject(api);
  const created = await api._api.projects({ projectId: project.id }).uploads.post(
    { originalFilename: "dist.zip", size: 1024 },
    { headers: { authorization: `Bearer ${refreshToken}` } },
  );
  const uploadTask = created.data?.uploadTask;
  if (!uploadTask) throw new Error("Upload task creation unexpectedly returned no task");

  const bytes = await Bun.file(join(import.meta.dir, "../../packages/deploy-core/tests/fixtures/valid-vite-relative-base.zip")).arrayBuffer();
  await api._api.uploads({ uploadTaskId: uploadTask.id }).raw.put(
    { file: new File([bytes], "dist.zip", { type: "application/zip" }) },
    { headers: { authorization: `Bearer ${refreshToken}` } },
  );
  await api._api.uploads({ uploadTaskId: uploadTask.id }).complete.post(null, {
    headers: { authorization: `Bearer ${refreshToken}` },
  });

  const releases = await api._api.projects({ projectId: project.id }).releases.get({
    headers: { authorization: `Bearer ${refreshToken}` },
  });
  const release = releases.data?.releases[0];
  if (!release) throw new Error("Release listing unexpectedly returned no release");

  return {
    app,
    project,
    release,
  };
}

describe("site preview routes", () => {
  test("rejects path traversal outside a ready release storage root", async () => {
    const storageRoot = createTempStorageRoot();
    try {
      const { app, project, release } = await createReadyRelease(storageRoot);

      const response = await app.handle(
        new Request(`http://localhost/_sites/${project.slug}/${release.releaseHash}/../secret.txt`),
      );

      expect(response.status).toBe(404);
    } finally {
      rmSync(storageRoot, { recursive: true, force: true });
    }
  });

  test("serves index.html for a ready release preview root", async () => {
    const storageRoot = createTempStorageRoot();
    try {
      const { app, project, release } = await createReadyRelease(storageRoot);

      const response = await app.handle(new Request(`http://localhost${release.previewUrl}`));

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/html");
      expect(await response.text()).toContain("./assets/index.js");
      expect(release.previewUrl).toBe(`/_sites/${project.slug}/${release.releaseHash}/`);
    } finally {
      rmSync(storageRoot, { recursive: true, force: true });
    }
  });

  test("serves static assets for a ready release preview", async () => {
    const storageRoot = createTempStorageRoot();
    try {
      const { app, release } = await createReadyRelease(storageRoot);

      const response = await app.handle(new Request(`http://localhost${release.previewUrl}assets/index.js`));

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/javascript");
      expect(await response.text()).toContain("console.log");
    } finally {
      rmSync(storageRoot, { recursive: true, force: true });
    }
  });

  test("falls back to index.html for deep SPA preview paths", async () => {
    const storageRoot = createTempStorageRoot();
    try {
      const { app, release } = await createReadyRelease(storageRoot);

      const response = await app.handle(new Request(`http://localhost${release.previewUrl}dashboard/settings`));

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/html");
      expect(await response.text()).toContain("./assets/index.js");
    } finally {
      rmSync(storageRoot, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
bun test tests/unit/site-preview-routes.test.ts
```

Expected: FAIL because the route and repository methods do not exist yet.

- [ ] **Step 3: Add site preview model**

Create `apps/api/src/modules/site-preview/model.ts`:

```ts
import { t } from "elysia";

export const sitePreviewParamsModel = t.Object({
  projectSlug: t.String(),
  releaseHash: t.String(),
});

export const sitePreviewModels = {
  "SitePreview.Params": sitePreviewParamsModel,
};

export type SitePreviewParams = typeof sitePreviewParamsModel.static;

export interface SitePreviewFile {
  kind: "file";
  absolutePath: string;
  contentType: string;
}

export interface SitePreviewNotFound {
  kind: "not-found";
}

export type SitePreviewResult = SitePreviewFile | SitePreviewNotFound;
```

- [ ] **Step 4: Add site preview service**

Create `apps/api/src/modules/site-preview/service.ts`:

```ts
import type { Release } from "../releases/model";
import type { Project } from "../projects/model";
import { contentTypeForPath, resolveStaticAssetPath } from "@zipship/storage";
import type { SitePreviewParams, SitePreviewResult } from "./model";

export interface SitePreviewRepository {
  findProjectBySlug(slug: string): Promise<Project | null>;
  findReadyReleaseByProjectIdAndHash(input: {
    projectId: string;
    releaseHash: string;
  }): Promise<Release | null>;
}

export interface SitePreviewServiceOptions {
  repository: SitePreviewRepository;
}

export class SitePreviewService {
  constructor(private readonly options: SitePreviewServiceOptions) {}

  async resolve(params: SitePreviewParams, requestPath: string): Promise<SitePreviewResult> {
    const project = await this.options.repository.findProjectBySlug(params.projectSlug);

    if (!project) return { kind: "not-found" };

    const release = await this.options.repository.findReadyReleaseByProjectIdAndHash({
      projectId: project.id,
      releaseHash: params.releaseHash,
    });

    if (!release || release.archivedAt !== null) return { kind: "not-found" };

    const resolved = await resolveStaticAssetPath({
      rootDir: release.storagePath,
      requestPath,
    });

    if (resolved.kind === "not-found") return resolved;

    return {
      kind: "file",
      absolutePath: resolved.absolutePath,
      contentType: contentTypeForPath(resolved.absolutePath),
    };
  }
}
```

- [ ] **Step 5: Add site preview module**

Create `apps/api/src/modules/site-preview/index.ts`:

```ts
import { Elysia } from "elysia";
import { sitePreviewModels } from "./model";
import { SitePreviewService } from "./service";
import type { SitePreviewRepository } from "./service";

export interface SitePreviewModuleOptions {
  repository: SitePreviewRepository;
}

export function sitePreviewModule(options: SitePreviewModuleOptions) {
  const sitePreview = new SitePreviewService({
    repository: options.repository,
  });

  async function serve(params: { projectSlug: string; releaseHash: string }, requestPath: string) {
    const result = await sitePreview.resolve(params, requestPath);

    if (result.kind === "not-found") {
      return new Response("Not Found", {
        status: 404,
      });
    }

    return new Response(Bun.file(result.absolutePath), {
      headers: {
        "content-type": result.contentType,
      },
    });
  }

  return new Elysia({ name: "site-preview", prefix: "/_sites/:projectSlug/:releaseHash" })
    .model(sitePreviewModels)
    .get("/", ({ params }) => serve(params, ""), {
      params: "SitePreview.Params",
    })
    .get("/*", ({ params }) => serve(params, params["*"] ?? ""), {
      params: "SitePreview.Params",
    });
}
```

If TypeScript does not know `params["*"]`, change only that handler to:

```ts
.get("/*", ({ params }) => serve(params, (params as typeof params & { "*": string })["*"] ?? ""), {
  params: "SitePreview.Params",
});
```

- [ ] **Step 6: Add repository methods**

Modify the returned object in `apps/api/src/modules/auth/repository.ts`.

After `findProjectById(projectId)`, add:

```ts
async findProjectBySlug(slug) {
  const project = Array.from(projects.values()).find((candidate) => candidate.slug === slug);

  return project ? toProject(project) : null;
},
```

After `listReleasesForProject(projectId)`, add:

```ts
async findReadyReleaseByProjectIdAndHash(input) {
  const release = Array.from(releases.values()).find(
    (candidate) =>
      candidate.projectId === input.projectId &&
      candidate.releaseHash === input.releaseHash &&
      candidate.status === "ready" &&
      candidate.archivedAt === null,
  );

  return release ? toRelease(release) : null;
},
```

- [ ] **Step 7: Wire module into app**

Modify `apps/api/src/index.ts`:

```ts
import { sitePreviewModule } from "./modules/site-preview";
```

Then add the module after uploads are wired:

```ts
    .use(uploadsModule({ repository, hashRefreshToken, storagePaths }))
    .use(uploadDetailsModule({ repository, hashRefreshToken, storagePaths }))
    .use(sitePreviewModule({ repository }));
```

- [ ] **Step 8: Run tests and typecheck**

Run:

```bash
bun test tests/unit/site-preview-routes.test.ts tests/unit/releases-routes.test.ts
bun run --filter @zipship/storage typecheck
bun run --filter @zipship/api typecheck
```

Expected: all commands exit with code 0.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/index.ts apps/api/src/modules/auth/repository.ts apps/api/src/modules/site-preview tests/unit/site-preview-routes.test.ts
git commit -m "feat: serve ready release previews"
```

---

### Task 5: Not Found And Non-Ready Preview Cases

**Files:**
- Modify: `tests/unit/site-preview-routes.test.ts`
- Modify: `apps/api/src/modules/site-preview/service.ts`
- Modify: `apps/api/src/modules/auth/repository.ts`

**Interfaces:**
- Consumes:
  - `findReadyReleaseByProjectIdAndHash()`
  - preview route from Task 4
- Produces:
  - 404 behavior for unknown slug, unknown hash, failed release, and encoded traversal.

- [ ] **Step 1: Add failing/strengthening 404 tests**

Append these tests inside `describe("site preview routes", ...)`:

```ts
async function createFailedRelease(storageRoot: string) {
  const app = createApp({ storageRoot });
  const api = treaty(app);
  const { refreshToken, project } = await registerLoginAndCreateProject(api);
  const created = await api._api.projects({ projectId: project.id }).uploads.post(
    { originalFilename: "dist.zip", size: 1024 },
    { headers: { authorization: `Bearer ${refreshToken}` } },
  );
  const uploadTask = created.data?.uploadTask;
  if (!uploadTask) throw new Error("Upload task creation unexpectedly returned no task");

  const bytes = await Bun.file(join(import.meta.dir, "../../packages/deploy-core/tests/fixtures/dot-env.zip")).arrayBuffer();
  await api._api.uploads({ uploadTaskId: uploadTask.id }).raw.put(
    { file: new File([bytes], "dist.zip", { type: "application/zip" }) },
    { headers: { authorization: `Bearer ${refreshToken}` } },
  );
  await api._api.uploads({ uploadTaskId: uploadTask.id }).complete.post(null, {
    headers: { authorization: `Bearer ${refreshToken}` },
  });

  const releases = await api._api.projects({ projectId: project.id }).releases.get({
    headers: { authorization: `Bearer ${refreshToken}` },
  });
  const release = releases.data?.releases[0];
  if (!release) throw new Error("Release listing unexpectedly returned no release");

  return {
    app,
    project,
    release,
  };
}

test("returns 404 for an unknown project slug", async () => {
  const storageRoot = createTempStorageRoot();
  try {
    const { app, release } = await createReadyRelease(storageRoot);

    const response = await app.handle(new Request(`http://localhost/_sites/missing-site/${release.releaseHash}/`));

    expect(response.status).toBe(404);
  } finally {
    rmSync(storageRoot, { recursive: true, force: true });
  }
});

test("returns 404 for an unknown release hash", async () => {
  const storageRoot = createTempStorageRoot();
  try {
    const { app, project } = await createReadyRelease(storageRoot);

    const response = await app.handle(new Request(`http://localhost/_sites/${project.slug}/missinghash123/`));

    expect(response.status).toBe(404);
  } finally {
    rmSync(storageRoot, { recursive: true, force: true });
  }
});

test("returns 404 for a failed release preview", async () => {
  const storageRoot = createTempStorageRoot();
  try {
    const { app, project, release } = await createFailedRelease(storageRoot);

    const response = await app.handle(new Request(`http://localhost/_sites/${project.slug}/${release.releaseHash}/`));

    expect(response.status).toBe(404);
  } finally {
    rmSync(storageRoot, { recursive: true, force: true });
  }
});

test("rejects encoded traversal paths", async () => {
  const storageRoot = createTempStorageRoot();
  try {
    const { app, project, release } = await createReadyRelease(storageRoot);

    const response = await app.handle(
      new Request(`http://localhost/_sites/${project.slug}/${release.releaseHash}/%2e%2e/secret.txt`),
    );

    expect(response.status).toBe(404);
  } finally {
    rmSync(storageRoot, { recursive: true, force: true });
  }
});

test("rejects backslash traversal paths", async () => {
  const storageRoot = createTempStorageRoot();
  try {
    const { app, project, release } = await createReadyRelease(storageRoot);

    const response = await app.handle(
      new Request(`http://localhost/_sites/${project.slug}/${release.releaseHash}/..%5Csecret.txt`),
    );

    expect(response.status).toBe(404);
  } finally {
    rmSync(storageRoot, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run tests**

Run:

```bash
bun test tests/unit/site-preview-routes.test.ts
```

Expected: PASS if Task 3/4 path and release checks are complete. If any test fails, fix only the corresponding service/helper branch.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/site-preview-routes.test.ts apps/api/src/modules/site-preview/service.ts apps/api/src/modules/auth/repository.ts packages/storage/src/index.ts
git commit -m "test: cover preview not found cases"
```

---

### Task 6: Documentation Updates

**Files:**
- Modify: `docs/02-技术架构.md`
- Modify: `docs/03-测试规范与实施路线.md`

**Interfaces:**
- Consumes:
  - Implemented preview route `/_sites/:projectSlug/:releaseHash/`
- Produces:
  - Chinese docs that accurately distinguish internal preview from future Nginx routes.

- [ ] **Step 1: Update architecture docs**

In `docs/02-技术架构.md`, under upload processing, update the final line of the flow from:

```txt
返回测试地址
```

to:

```txt
返回内部测试地址 /_sites/:projectSlug/:releaseHash/
```

After the “当前实现” paragraph, add:

```md
内部测试地址由 API 直接提供：`/_sites/:projectSlug/:releaseHash/`。该地址只服务 `ready` 且未归档的 release，并且只能读取 `release.storagePath` 内的静态文件。目录请求和 SPA 深路径会 fallback 到 `index.html`；未知项目、未知 hash、失败 release、路径穿越都会返回 404。正式地址 `/:slug/` 与 Nginx 测试地址 `/:slug/:hash/` 仍属于 Phase 4 / Phase 5 后续工作。
```

In the “需要额外处理” list, remove:

```txt
测试地址生成与静态服务路由
```

Keep these items:

```txt
上传中断
重复上传策略
hash 冲突
同项目并发上传
用户取消上传
处理任务失败后重试
temp 目录清理
```

- [ ] **Step 2: Update testing roadmap**

In `docs/03-测试规范与实施路线.md`, change the Phase 3 list item:

```txt
返回测试地址
```

to:

```txt
✓ 返回内部测试地址 /_sites/:projectSlug/:releaseHash/
```

Do not mark Phase 4 Nginx items complete.

- [ ] **Step 3: Verify docs**

Run:

```bash
rg -n "返回测试地址|/_sites|Nginx|/:slug/:hash|测试地址生成" docs/02-技术架构.md docs/03-测试规范与实施路线.md
```

Expected:
- `/_sites/:projectSlug/:releaseHash/` appears in both docs.
- `测试地址生成与静态服务路由` no longer appears in the extra handling list.
- Phase 4 still contains Nginx routing work.

- [ ] **Step 4: Commit**

```bash
git add docs/02-技术架构.md docs/03-测试规范与实施路线.md
git commit -m "docs: document internal site previews"
```

---

### Task 7: Full Verification And Handoff Summary

**Files:**
- No production edits expected.
- May update `.codegraph/` locally, but do not commit `.codegraph/`.

**Interfaces:**
- Consumes:
  - All previous task changes.
- Produces:
  - Verified branch ready for review.

- [ ] **Step 1: Run full verification sequentially**

Run these commands in order. Do not run `bun test` and `bun test --coverage` in parallel because deploy-core tests share `.tmp-*` folders and can interfere with each other.

```bash
bun test
bun test --coverage
bun run typecheck
bun run db:generate
bun --filter @zipship/desktop-shell lint
bun --filter @zipship/desktop-shell package
codegraph sync .
```

Expected:
- `bun test`: 0 failures.
- `bun test --coverage`: 0 failures.
- `bun run typecheck`: exits with code 0.
- `bun run db:generate`: no unexpected schema drift.
- Desktop lint/package pass. The existing `inlineDynamicImports` warning may still appear and is not part of this plan.
- CodeGraph sync completes successfully.

- [ ] **Step 2: Check generated files**

Run:

```bash
git status --short
git ls-files --others --exclude-standard
find . -name '.DS_Store' -o -name '.env.local' -o -name '.tmp-*' | sort
```

Expected:
- No uncommitted implementation changes after task commits.
- No untracked generated files need to be committed.
- No `.DS_Store`, `.env.local`, or `.tmp-*` files remain.

- [ ] **Step 3: Prepare review summary**

Write this Chinese summary for review:

```txt
本轮实现：
- release 列表新增 previewUrl，ready 且未归档 release 返回 /_sites/:projectSlug/:releaseHash/
- 新增 site-preview Elysia 模块，服务 ready release 的静态文件
- 目录请求和 SPA 深路径 fallback 到 index.html
- 未知 slug/hash、failed release、路径穿越返回 404
- storage 层新增安全静态路径解析与 content-type 映射
- 中文文档标注 Phase 3 内部测试地址完成，Nginx 正式访问仍留在 Phase 4

验证：
- bun test
- bun test --coverage
- bun run typecheck
- bun run db:generate
- bun --filter @zipship/desktop-shell lint
- bun --filter @zipship/desktop-shell package
- codegraph sync .
```

---

## Self-Review Checklist For Implementer

- [ ] Every implementation task began with a failing or strengthening test before production code changed.
- [ ] Project slugs are globally unique before `/_sites/:projectSlug/:releaseHash/` is introduced.
- [ ] `previewUrl` is `/_sites/{project.slug}/{release.releaseHash}/` only for ready, non-archived releases.
- [ ] Static preview route never reads outside `release.storagePath`.
- [ ] Unknown slug, unknown hash, failed release, and traversal paths return 404.
- [ ] SPA fallback returns `index.html`.
- [ ] Content-Type is set for HTML, JS, CSS, JSON, SVG, PNG, JPG/JPEG, WebP, ICO, and unknown files.
- [ ] Phase 3 docs mark internal test address complete.
- [ ] Phase 4 docs still keep Nginx formal routing as future work.
- [ ] Full verification passes sequentially and the worktree is clean.
