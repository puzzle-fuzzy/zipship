# Nginx 访问面实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build ZipShip's real Nginx-backed access plane so uploaded artifacts live under slug-based paths, publish/rollback switches `current`, and Nginx can serve `/:slug/` plus `/:slug/:releaseHash/`.

**Architecture:** Keep Elysia as the control plane and Nginx/filesystem as the access plane. Storage helpers own slug-based paths and symlink operations; `DeploymentsService` orchestrates artifact readiness, symlink switching, metadata mutation, and audit logging; Nginx routing tests validate static access separately.

**Tech Stack:** Bun, Bun Test, Elysia 1.4.29, `@elysia/eden` Treaty tests, Node/Bun filesystem APIs, Nginx when available, existing `@zipship/storage`.

## Global Constraints

- **测试先行是硬要求：每个任务必须先写会失败的测试，先运行并确认失败，再改实现。**
- Do not touch or commit the existing dirty `CLAUDE.md` file.
- Do not add npm dependencies.
- Keep backend responses language-independent: stable English `code` values only.
- Do not implement HTTPS, custom domains, Docker Compose, real PostgreSQL repository, project-level publish locks, project slug rename, Web UI, Desktop UI, object storage, or deletion of `/_sites`.
- Release artifact storage must become `storageRoot/sites/:projectSlug/releases/:releaseHash/`.
- `current` must be a relative symlink: `current -> releases/:releaseHash`.
- `DeploymentsService` must receive storage dependency injection; repository must not directly operate on the filesystem.
- Nginx tests must skip cleanly when `nginx` is unavailable.
- Use root env and existing Bun Catalogs.
- After each task, commit only files touched by that task.

---

## File Map

- Modify: `packages/storage/src/index.ts`
  - Add slug-based site path helpers, artifact readiness checks, and current symlink switching.
- Modify: `tests/unit/storage-static.test.ts`
  - Cover slug path helpers and symlink behavior.
- Modify: `apps/api/src/modules/release-processing/service.ts`
  - Store processed release artifacts under `sites/:projectSlug/releases/:hash`.
- Modify: `apps/api/src/modules/release-processing/model.ts`
  - Add `PROJECT_NOT_FOUND` processing error code.
- Modify: `apps/api/src/modules/uploads/index.ts`
  - Type upload details repository as both upload and release-processing repository.
- Modify: `apps/api/src/modules/auth/repository.ts`
  - Declare the in-memory repository implements release-processing repository contract.
- Modify: `tests/unit/uploads-routes.test.ts`
  - Assert release storage path uses project slug and not project id.
- Modify: `apps/api/src/modules/deployments/model.ts`
  - Add `RELEASE_ARTIFACT_NOT_FOUND` and `FILESYSTEM_UPDATE_FAILED`.
- Modify: `apps/api/src/modules/deployments/service.ts`
  - Inject storage dependency, validate artifact, switch symlink before repository mutation, return filesystem errors.
- Modify: `apps/api/src/modules/deployments/index.ts`
  - Pass storage dependency and map new errors to 409.
- Modify: `apps/api/src/index.ts`
  - Build deployment storage from `storagePaths` and wire it into `deploymentsModule`.
- Modify: `tests/unit/deployments-routes.test.ts`
  - Assert publish/rollback symlink behavior and filesystem failure behavior.
- Create: `infra/nginx/zipship.conf`
  - Nginx access-plane template.
- Create: `tests/nginx/nginx-routing.test.ts`
  - Nginx routing tests with clean skip when nginx is unavailable.
- Modify: `docs/02-技术架构.md`
- Modify: `docs/03-测试规范与实施路线.md`
- Modify: `infra/nginx/README.md`
- Modify: `tests/README.md`

---

### Task 1: Storage Path And Symlink Helpers

**Files:**
- Modify: `packages/storage/src/index.ts`
- Modify: `tests/unit/storage-static.test.ts`

**Interfaces:**
- Consumes:
  - `StoragePaths`
- Produces:
  - `createProjectSitePath(paths: StoragePaths, projectSlug: string): string`
  - `createReleaseStoragePath(paths: StoragePaths, input: { projectSlug: string; releaseHash: string }): string`
  - `createCurrentReleaseLinkPath(paths: StoragePaths, projectSlug: string): string`
  - `ensureReleaseArtifactReady(storagePath: string): Promise<void>`
  - `switchCurrentReleaseLink(input: { projectSitePath: string; releaseHash: string }): Promise<void>`
  - `ReleaseArtifactNotFoundError`
  - `CurrentReleaseLinkError`

- [ ] **Step 1: Write failing storage helper tests**

Append these tests to `tests/unit/storage-static.test.ts`:

```ts
import { existsSync, lstatSync, mkdtempSync, readlinkSync, rmSync, writeFileSync } from "fs";
import { mkdir } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import {
  createCurrentReleaseLinkPath,
  createProjectSitePath,
  createReleaseStoragePath,
  createStoragePaths,
  ensureReleaseArtifactReady,
  switchCurrentReleaseLink,
  ReleaseArtifactNotFoundError,
} from "../../packages/storage/src/index";

function createTempStorageRoot() {
  return mkdtempSync(join(tmpdir(), "zipship-storage-access-"));
}

describe("slug-based site storage paths", () => {
  test("creates project site, release, and current paths from project slug", () => {
    const paths = createStoragePaths("/srv/zipship");

    expect(createProjectSitePath(paths, "admin")).toBe("/srv/zipship/sites/admin");
    expect(createReleaseStoragePath(paths, { projectSlug: "admin", releaseHash: "a8f32c91abcd" })).toBe(
      "/srv/zipship/sites/admin/releases/a8f32c91abcd",
    );
    expect(createCurrentReleaseLinkPath(paths, "admin")).toBe("/srv/zipship/sites/admin/current");
  });

  test("verifies a release artifact directory with index.html", async () => {
    const root = createTempStorageRoot();
    try {
      const artifact = join(root, "sites", "admin", "releases", "a8f32c91abcd");
      await mkdir(artifact, { recursive: true });
      writeFileSync(join(artifact, "index.html"), "<html></html>");

      await expect(ensureReleaseArtifactReady(artifact)).resolves.toBeUndefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("rejects missing artifact directory or missing index.html", async () => {
    const root = createTempStorageRoot();
    try {
      const artifact = join(root, "sites", "admin", "releases", "a8f32c91abcd");
      await expect(ensureReleaseArtifactReady(artifact)).rejects.toBeInstanceOf(ReleaseArtifactNotFoundError);

      await mkdir(artifact, { recursive: true });
      await expect(ensureReleaseArtifactReady(artifact)).rejects.toBeInstanceOf(ReleaseArtifactNotFoundError);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("switches current to a relative release symlink and replaces old links", async () => {
    const root = createTempStorageRoot();
    try {
      const paths = createStoragePaths(root);
      const projectSitePath = createProjectSitePath(paths, "admin");
      await mkdir(join(projectSitePath, "releases", "a8f32c91abcd"), { recursive: true });
      await mkdir(join(projectSitePath, "releases", "b7d91f20cafe"), { recursive: true });

      await switchCurrentReleaseLink({ projectSitePath, releaseHash: "a8f32c91abcd" });
      expect(lstatSync(createCurrentReleaseLinkPath(paths, "admin")).isSymbolicLink()).toBe(true);
      expect(readlinkSync(createCurrentReleaseLinkPath(paths, "admin"))).toBe("releases/a8f32c91abcd");

      await switchCurrentReleaseLink({ projectSitePath, releaseHash: "b7d91f20cafe" });
      expect(readlinkSync(createCurrentReleaseLinkPath(paths, "admin"))).toBe("releases/b7d91f20cafe");
      expect(existsSync(join(projectSitePath, "current.tmp"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run the storage tests and confirm failure**

Run:

```bash
bun test tests/unit/storage-static.test.ts --test-name-pattern "slug-based|release artifact|relative release symlink"
```

Expected: FAIL because the new helpers and error classes do not exist.

- [ ] **Step 3: Implement storage helpers**

Modify imports in `packages/storage/src/index.ts`:

```ts
import { cp, mkdir, realpath, rm, stat, symlink, rename, unlink } from "fs/promises";
```

Replace `createReleaseStoragePath` and add helpers:

```ts
export class ReleaseArtifactNotFoundError extends Error {
  constructor(message = "Release artifact not found") {
    super(message);
    this.name = "ReleaseArtifactNotFoundError";
  }
}

export class CurrentReleaseLinkError extends Error {
  constructor(message = "Failed to update current release link") {
    super(message);
    this.name = "CurrentReleaseLinkError";
  }
}

export function createProjectSitePath(paths: StoragePaths, projectSlug: string): string {
  return join(paths.sitesRoot, projectSlug);
}

export function createReleaseStoragePath(
  paths: StoragePaths,
  input: {
    projectSlug: string;
    releaseHash: string;
  },
): string {
  return join(createProjectSitePath(paths, input.projectSlug), "releases", input.releaseHash);
}

export function createCurrentReleaseLinkPath(paths: StoragePaths, projectSlug: string): string {
  return join(createProjectSitePath(paths, projectSlug), "current");
}

export async function ensureReleaseArtifactReady(storagePath: string): Promise<void> {
  const artifact = await statFile(storagePath);
  if (artifact !== "directory") throw new ReleaseArtifactNotFoundError();

  const index = await statFile(join(storagePath, "index.html"));
  if (index !== "file") throw new ReleaseArtifactNotFoundError();
}

export async function switchCurrentReleaseLink(input: {
  projectSitePath: string;
  releaseHash: string;
}): Promise<void> {
  const currentPath = join(input.projectSitePath, "current");
  const tempPath = join(input.projectSitePath, "current.tmp");

  try {
    await mkdir(input.projectSitePath, { recursive: true });
    await rm(tempPath, { force: true, recursive: false });
    await symlink(join("releases", input.releaseHash), tempPath);
    await unlink(currentPath).catch(() => {});
    await rename(tempPath, currentPath);
  } catch (error) {
    await rm(tempPath, { force: true, recursive: false }).catch(() => {});
    throw new CurrentReleaseLinkError(error instanceof Error ? error.message : undefined);
  }
}
```

- [ ] **Step 4: Run focused storage tests**

Run:

```bash
bun test tests/unit/storage-static.test.ts --test-name-pattern "slug-based|release artifact|relative release symlink"
bun run --filter @zipship/storage typecheck
```

Expected: both commands exit with code 0.

- [ ] **Step 5: Commit**

```bash
git add packages/storage/src/index.ts tests/unit/storage-static.test.ts
git commit -m "feat: add site storage symlink helpers"
```

---

### Task 2: Store Release Artifacts Under Project Slug

**Files:**
- Modify: `apps/api/src/modules/release-processing/service.ts`
- Modify: `apps/api/src/modules/release-processing/model.ts`
- Modify: `apps/api/src/modules/uploads/index.ts`
- Modify: `apps/api/src/modules/auth/repository.ts`
- Modify: `tests/unit/uploads-routes.test.ts`
- Modify: `tests/unit/releases-routes.test.ts`

**Interfaces:**
- Consumes:
  - `createReleaseStoragePath(paths, { projectSlug, releaseHash })`
  - `UploadsRepository.findProjectById(projectId)`
- Produces:
  - `ReleaseProcessingRepository.findProjectById(projectId): Promise<Project | null>`
  - Processed release artifacts stored at `sites/:projectSlug/releases/:releaseHash`.

- [ ] **Step 1: Write failing slug storage path tests**

In `tests/unit/uploads-routes.test.ts`, update the existing assertions that check storage path to expect slug-based storage. In the `"completes an uploaded zip and marks its release ready"` test, replace:

```ts
expect(firstRelease.storagePath).toContain(project.id);
```

with:

```ts
expect(firstRelease.storagePath).toContain(project.slug);
expect(firstRelease.storagePath).not.toContain(project.id);
```

In `tests/unit/releases-routes.test.ts`, replace:

```ts
expect(release.storagePath).toContain(project.id);
```

with:

```ts
expect(release.storagePath).toContain(project.slug);
expect(release.storagePath).not.toContain(project.id);
```

- [ ] **Step 2: Run tests and confirm failure**

Run:

```bash
bun test tests/unit/uploads-routes.test.ts --test-name-pattern "completes an uploaded zip"
bun test tests/unit/releases-routes.test.ts --test-name-pattern "lists project releases"
```

Expected: FAIL because storage paths still include project id.

- [ ] **Step 3: Extend release processing repository**

Modify `apps/api/src/modules/release-processing/service.ts`.

Add import:

```ts
import type { Project } from "../projects/model";
```

Add to `ReleaseProcessingRepository`:

```ts
findProjectById(projectId: string): Promise<Project | null>;
```

In `processUploadTask()`, after raw upload checks and before work dir:

```ts
const project = await this.options.repository.findProjectById(uploadTask.projectId);
if (!project) return new ReleaseProcessingError("PROJECT_NOT_FOUND");
```

Change release storage path creation:

```ts
const releaseStoragePath = createReleaseStoragePath(this.options.storagePaths, {
  projectSlug: project.slug,
  releaseHash: result.manifest.releaseHash,
});
```

- [ ] **Step 4: Add release processing error code**

Modify `apps/api/src/modules/release-processing/model.ts` so its error code union includes:

```ts
t.Literal("PROJECT_NOT_FOUND")
```

If the model uses a const string union instead of TypeBox, add `"PROJECT_NOT_FOUND"` to that union.

- [ ] **Step 5: Wire the expanded repository type**

Modify `apps/api/src/modules/uploads/index.ts`.

Add import:

```ts
import type { ReleaseProcessingRepository } from "../release-processing/service";
```

Change `UploadsModuleOptions.repository` to:

```ts
repository: UploadsRepository & ReleaseProcessingRepository;
```

Modify `apps/api/src/modules/auth/repository.ts`.

Add import:

```ts
import type { ReleaseProcessingRepository } from "../release-processing/service";
```

Add `ReleaseProcessingRepository` to the `createInMemoryAuthRepository()` return type intersection. The existing `findProjectById()` method should satisfy the new method; do not duplicate it.

- [ ] **Step 6: Run focused tests**

Run:

```bash
bun test tests/unit/uploads-routes.test.ts --test-name-pattern "completes an uploaded zip"
bun test tests/unit/releases-routes.test.ts --test-name-pattern "lists project releases"
bun run --filter @zipship/api typecheck
```

Expected: all commands exit with code 0.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/release-processing apps/api/src/modules/uploads/index.ts apps/api/src/modules/auth/repository.ts tests/unit/uploads-routes.test.ts tests/unit/releases-routes.test.ts
git commit -m "feat: store releases by project slug"
```

---

### Task 3: Switch Current Symlink On Publish And Rollback

**Files:**
- Modify: `apps/api/src/modules/deployments/model.ts`
- Modify: `apps/api/src/modules/deployments/service.ts`
- Modify: `apps/api/src/modules/deployments/index.ts`
- Modify: `apps/api/src/index.ts`
- Modify: `tests/unit/deployments-routes.test.ts`

**Interfaces:**
- Consumes:
  - `ensureReleaseArtifactReady(storagePath)`
  - `switchCurrentReleaseLink({ projectSitePath, releaseHash })`
  - `createProjectSitePath(storagePaths, project.slug)`
- Produces:
  - `DeploymentStorage`
  - `RELEASE_ARTIFACT_NOT_FOUND`
  - `FILESYSTEM_UPDATE_FAILED`

- [ ] **Step 1: Write failing symlink success tests**

Add imports to `tests/unit/deployments-routes.test.ts`:

```ts
import { existsSync, readlinkSync, rmSync as removeSync } from "fs";
import { mkdir } from "fs/promises";
```

If `rmSync` or `mkdir` is already imported, do not import it twice; use the existing import and add only the missing names.

Append assertions to `"publishes a ready release and records deployment and audit"` after publish success:

```ts
const currentPath = join(storageRoot, "sites", project.slug, "current");
expect(existsSync(currentPath)).toBe(true);
expect(readlinkSync(currentPath)).toBe(`releases/${release.releaseHash}`);
```

Append assertions to `"rolls back to a previous ready release and records deployment and audit"` after rollback success:

```ts
const currentPath = join(storageRoot, "sites", project.slug, "current");
expect(readlinkSync(currentPath)).toBe(`releases/${firstRelease.releaseHash}`);
```

- [ ] **Step 2: Write failing filesystem error tests**

Append:

```ts
test("rejects publish when artifact index.html is missing without changing current release", async () => {
  const storageRoot = createTempStorageRoot();
  try {
    const api = treaty(createApp({ storageRoot, exposeTestRoutes: true }));
    const { refreshToken, project } = await registerLoginAndCreateProject(api);
    const release = await createReadyRelease(api, project.id, refreshToken);

    removeSync(join(release.storagePath, "index.html"));

    const response = await api._api.projects({ projectId: project.id }).releases({ releaseId: release.id }).publish.post(
      { message: "Ship broken artifact" },
      { headers: { authorization: `Bearer ${refreshToken}` } },
    );

    expect(response.status).toBe(409);
    expect((response.error?.value as unknown)).toEqual({ code: "RELEASE_ARTIFACT_NOT_FOUND" });

    const detail = await api._api.projects({ projectId: project.id }).get({
      headers: { authorization: `Bearer ${refreshToken}` },
    });
    expect(detail.data?.project.currentReleaseId).toBeNull();
  } finally {
    rmSync(storageRoot, { recursive: true, force: true });
  }
});
```

Append:

```ts
test("rejects publish when current symlink cannot be updated without changing current release", async () => {
  const storageRoot = createTempStorageRoot();
  try {
    const api = treaty(createApp({ storageRoot, exposeTestRoutes: true }));
    const { refreshToken, project } = await registerLoginAndCreateProject(api);
    const release = await createReadyRelease(api, project.id, refreshToken);

    const currentPath = join(storageRoot, "sites", project.slug, "current");
    await mkdir(currentPath, { recursive: true });

    const response = await api._api.projects({ projectId: project.id }).releases({ releaseId: release.id }).publish.post(
      { message: "Ship v1" },
      { headers: { authorization: `Bearer ${refreshToken}` } },
    );

    expect(response.status).toBe(409);
    expect((response.error?.value as unknown)).toEqual({ code: "FILESYSTEM_UPDATE_FAILED" });

    const detail = await api._api.projects({ projectId: project.id }).get({
      headers: { authorization: `Bearer ${refreshToken}` },
    });
    expect(detail.data?.project.currentReleaseId).toBeNull();
  } finally {
    rmSync(storageRoot, { recursive: true, force: true });
  }
});
```

- [ ] **Step 3: Run tests and confirm failure**

Run:

```bash
bun test tests/unit/deployments-routes.test.ts --test-name-pattern "symlink|artifact index|cannot be updated|publishes a ready|rolls back"
```

Expected: FAIL because deployment service does not touch storage links or return new filesystem error codes.

- [ ] **Step 4: Add deployment errors**

Modify `apps/api/src/modules/deployments/model.ts`.

Add to `deploymentErrorModel`:

```ts
t.Literal("RELEASE_ARTIFACT_NOT_FOUND"),
t.Literal("FILESYSTEM_UPDATE_FAILED"),
```

Add classes:

```ts
export class DeploymentReleaseArtifactNotFoundError extends DeploymentServiceError {
  constructor() {
    super("RELEASE_ARTIFACT_NOT_FOUND");
  }
}

export class DeploymentFilesystemUpdateError extends DeploymentServiceError {
  constructor() {
    super("FILESYSTEM_UPDATE_FAILED");
  }
}
```

- [ ] **Step 5: Inject deployment storage**

Modify `apps/api/src/modules/deployments/service.ts`.

Add imports:

```ts
import { CurrentReleaseLinkError, ReleaseArtifactNotFoundError } from "@zipship/storage";
```

Add interface:

```ts
export interface DeploymentStorage {
  createProjectSitePath(projectSlug: string): string;
  ensureReleaseArtifactReady(storagePath: string): Promise<void>;
  switchCurrentReleaseLink(input: {
    projectSitePath: string;
    releaseHash: string;
  }): Promise<void>;
}
```

Add to options:

```ts
storage: DeploymentStorage;
```

In `publish()` after release readiness checks and before repository mutation:

```ts
const storageReady = await this.prepareCurrentLink(project, release);
if (storageReady instanceof DeploymentServiceError) return storageReady;
```

In `rollback()` after rollbackability checks and before repository mutation:

```ts
const storageReady = await this.prepareCurrentLink(project, release);
if (storageReady instanceof DeploymentServiceError) return storageReady;
```

Add private method:

```ts
private async prepareCurrentLink(project: Project, release: Release): Promise<void | DeploymentServiceError> {
  try {
    await this.options.storage.ensureReleaseArtifactReady(release.storagePath);
    await this.options.storage.switchCurrentReleaseLink({
      projectSitePath: this.options.storage.createProjectSitePath(project.slug),
      releaseHash: release.releaseHash,
    });
  } catch (error) {
    if (error instanceof ReleaseArtifactNotFoundError) return new DeploymentReleaseArtifactNotFoundError();
    if (error instanceof CurrentReleaseLinkError) return new DeploymentFilesystemUpdateError();
    return new DeploymentFilesystemUpdateError();
  }
}
```

Use the imported `DeploymentReleaseArtifactNotFoundError` and `DeploymentFilesystemUpdateError` classes.

- [ ] **Step 6: Wire storage in controller and app**

Modify `apps/api/src/modules/deployments/index.ts`:

```ts
import type { DeploymentStorage, DeploymentsRepository } from "./service";
```

Add to options:

```ts
storage: DeploymentStorage;
```

Pass into service:

```ts
storage: options.storage,
```

Ensure `toStatusCode()` maps new codes to 409 by falling through to the existing default.

Modify `apps/api/src/index.ts` imports:

```ts
import {
  createProjectSitePath,
  createStoragePaths,
  ensureReleaseArtifactReady,
  switchCurrentReleaseLink,
} from "@zipship/storage";
```

Before returning the app, create:

```ts
const deploymentStorage = {
  createProjectSitePath: (projectSlug: string) => createProjectSitePath(storagePaths, projectSlug),
  ensureReleaseArtifactReady,
  switchCurrentReleaseLink,
};
```

Wire:

```ts
.use(deploymentsModule({ repository, hashRefreshToken, storage: deploymentStorage }))
```

- [ ] **Step 7: Run focused checks**

Run:

```bash
bun test tests/unit/deployments-routes.test.ts --test-name-pattern "artifact index|cannot be updated|publishes a ready|rolls back"
bun run --filter @zipship/api typecheck
```

Expected: all commands exit with code 0.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/index.ts apps/api/src/modules/deployments tests/unit/deployments-routes.test.ts
git commit -m "feat: switch current release symlink"
```

---

### Task 4: Nginx Access Plane Template And Routing Tests

**Files:**
- Create: `infra/nginx/zipship.conf`
- Create: `tests/nginx/nginx-routing.test.ts`
- Modify: `tests/README.md`
- Modify: `infra/nginx/README.md`

**Interfaces:**
- Consumes:
  - slug-based filesystem layout
  - Nginx binary when installed
- Produces:
  - Nginx config template with `__ZIPSHIP_SITES_ROOT__`, `__ZIPSHIP_API_UPSTREAM__`, `__ZIPSHIP_CONSOLE_ROOT__`
  - skip-safe Nginx routing tests

- [ ] **Step 1: Write failing Nginx routing test**

Create `tests/nginx/nginx-routing.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { mkdir } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

const nginxAvailable = await commandSucceeds(["nginx", "-v"]);

describe.skipIf(!nginxAvailable)("nginx access plane routing", () => {
  const root = mkdtempSync(join(tmpdir(), "zipship-nginx-"));
  const sitesRoot = join(root, "sites");
  const consoleRoot = join(root, "console");
  const confPath = join(root, "zipship.conf");
  const pidPath = join(root, "nginx.pid");
  const port = 18080 + Math.floor(Math.random() * 1000);

  beforeAll(async () => {
    await mkdir(join(sitesRoot, "admin", "releases", "a8f32c91abcd", "assets"), { recursive: true });
    await mkdir(join(sitesRoot, "admin", "current", "assets"), { recursive: true });
    await mkdir(consoleRoot, { recursive: true });

    writeFileSync(join(sitesRoot, "admin", "releases", "a8f32c91abcd", "index.html"), "release index");
    writeFileSync(join(sitesRoot, "admin", "releases", "a8f32c91abcd", "assets", "index.js"), "release asset");
    writeFileSync(join(sitesRoot, "admin", "current", "index.html"), "current index");
    writeFileSync(join(sitesRoot, "admin", "current", "assets", "index.js"), "current asset");
    writeFileSync(join(consoleRoot, "index.html"), "console app");

    const template = await Bun.file(join(import.meta.dir, "../../infra/nginx/zipship.conf")).text();
    writeFileSync(
      confPath,
      template
        .replaceAll("__ZIPSHIP_LISTEN_PORT__", String(port))
        .replaceAll("__ZIPSHIP_SITES_ROOT__", sitesRoot)
        .replaceAll("__ZIPSHIP_CONSOLE_ROOT__", consoleRoot)
        .replaceAll("__ZIPSHIP_API_UPSTREAM__", "http://127.0.0.1:9")
        .replaceAll("__ZIPSHIP_NGINX_PID__", pidPath),
    );

    const proc = Bun.spawn(["nginx", "-c", confPath, "-p", root], { stderr: "pipe" });
    const code = await proc.exited;
    if (code !== 0) {
      throw new Error(await new Response(proc.stderr).text());
    }
  });

  afterAll(async () => {
    if (existsSync(pidPath)) {
      await Bun.spawn(["nginx", "-s", "stop", "-c", confPath, "-p", root]).exited;
    }
    rmSync(root, { recursive: true, force: true });
  });

  test("redirects slug and release hash roots to trailing slash", async () => {
    const current = await fetch(`http://127.0.0.1:${port}/admin`, { redirect: "manual" });
    expect(current.status).toBe(308);
    expect(current.headers.get("location")).toBe("/admin/");

    const release = await fetch(`http://127.0.0.1:${port}/admin/a8f32c91abcd`, { redirect: "manual" });
    expect(release.status).toBe(308);
    expect(release.headers.get("location")).toBe("/admin/a8f32c91abcd/");
  });

  test("serves current and release files with SPA fallback", async () => {
    await expectText(`http://127.0.0.1:${port}/admin/`, "current index");
    await expectText(`http://127.0.0.1:${port}/admin/assets/index.js`, "current asset");
    await expectText(`http://127.0.0.1:${port}/admin/settings`, "current index");
    await expectText(`http://127.0.0.1:${port}/admin/a8f32c91abcd/`, "release index");
    await expectText(`http://127.0.0.1:${port}/admin/a8f32c91abcd/assets/index.js`, "release asset");
    await expectText(`http://127.0.0.1:${port}/admin/a8f32c91abcd/settings`, "release index");
    await expectText(`http://127.0.0.1:${port}/admin/not-a-hash/settings`, "current index");
  });

  test("serves console and keeps unknown sites or hashes as 404", async () => {
    await expectText(`http://127.0.0.1:${port}/_console/`, "console app");

    expect((await fetch(`http://127.0.0.1:${port}/missing/`)).status).toBe(404);
    expect((await fetch(`http://127.0.0.1:${port}/admin/deadbeef0000/`)).status).toBe(404);
  });
});

async function expectText(url: string, expected: string) {
  const response = await fetch(url);
  expect(response.status).toBe(200);
  expect(await response.text()).toContain(expected);
}

async function commandSucceeds(command: string[]): Promise<boolean> {
  try {
    return (await Bun.spawn(command, { stdout: "ignore", stderr: "ignore" }).exited) === 0;
  } catch {
    console.warn("Skipping nginx routing tests because nginx is not installed.");
    return false;
  }
}
```

- [ ] **Step 2: Run Nginx test and confirm failure or skip**

Run:

```bash
bun test tests/nginx
```

Expected:

- If nginx is unavailable: SKIP with clear message.
- If nginx is available: FAIL because `infra/nginx/zipship.conf` does not exist.

- [ ] **Step 3: Add Nginx config template**

Create `infra/nginx/zipship.conf`:

```nginx
worker_processes  1;
pid __ZIPSHIP_NGINX_PID__;

events {
  worker_connections  1024;
}

http {
  default_type  application/octet-stream;
  sendfile      on;

  server {
    listen __ZIPSHIP_LISTEN_PORT__;
    server_name _;

    location ^~ /_api/ {
      proxy_pass __ZIPSHIP_API_UPSTREAM__;
    }

    location ^~ /_sites/ {
      proxy_pass __ZIPSHIP_API_UPSTREAM__;
    }

    location ^~ /_console/ {
      alias __ZIPSHIP_CONSOLE_ROOT__/;
      try_files $uri $uri/ /index.html;
      add_header Cache-Control "no-cache";
    }

    location ~ ^/([a-z0-9][a-z0-9_-]*)/([a-f0-9]{12})$ {
      return 308 /$1/$2/;
    }

    location ~ ^/([a-z0-9][a-z0-9_-]*)$ {
      return 308 /$1/;
    }

    location ~ ^/([a-z0-9][a-z0-9_-]*)/([a-f0-9]{12})/(.*)$ {
      alias __ZIPSHIP_SITES_ROOT__/$1/releases/$2/$3;
      try_files $uri $uri/ /$1/$2/index.html;
      add_header Cache-Control "public, max-age=31536000, immutable";
    }

    location ~ ^/([a-z0-9][a-z0-9_-]*)/([a-f0-9]{12})/$ {
      alias __ZIPSHIP_SITES_ROOT__/$1/releases/$2/;
      try_files index.html =404;
      add_header Cache-Control "no-cache";
    }

    location ~ ^/([a-z0-9][a-z0-9_-]*)/(.*)$ {
      alias __ZIPSHIP_SITES_ROOT__/$1/current/$2;
      try_files $uri $uri/ /$1/index.html;
      add_header Cache-Control "public, max-age=31536000, immutable";
    }

    location ~ ^/([a-z0-9][a-z0-9_-]*)/$ {
      alias __ZIPSHIP_SITES_ROOT__/$1/current/;
      try_files index.html =404;
      add_header Cache-Control "no-cache";
    }
  }
}
```

- [ ] **Step 4: Run Nginx tests**

Run:

```bash
bun test tests/nginx
```

Expected:

- If nginx is unavailable: clean skip.
- If nginx is available: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add infra/nginx/zipship.conf tests/nginx/nginx-routing.test.ts
git commit -m "feat: add nginx access routing"
```

---

### Task 5: Documentation And Full Verification

**Files:**
- Modify: `docs/02-技术架构.md`
- Modify: `docs/03-测试规范与实施路线.md`
- Modify: `infra/nginx/README.md`
- Modify: `tests/README.md`

**Interfaces:**
- Consumes:
  - Storage helpers, slug-based artifact paths, current symlink switching, Nginx template.
- Produces:
  - Updated Chinese documentation and final verification evidence.

- [ ] **Step 1: Update architecture docs**

Modify `docs/02-技术架构.md` storage and publish sections to explicitly state:

```txt
当前访问面使用 storageRoot/sites/:projectSlug/releases/:releaseHash/ 保存 release artifact。
发布和回滚通过 storageRoot/sites/:projectSlug/current -> releases/:releaseHash 这个相对软链接切换正式版本。
Nginx 只读文件系统，不查询 Elysia 控制面。
/_sites/:projectSlug/:releaseHash/ 仍作为内部预览地址保留。
```

- [ ] **Step 2: Update roadmap docs**

Modify `docs/03-测试规范与实施路线.md` Phase 4 to:

```txt
✓ 准备 sites/:projectSlug 目录结构
✓ 正式地址 /:slug/
✓ 测试地址 /:slug/:hash/
✓ 无尾斜杠跳转
✓ SPA fallback
✓ Nginx routing tests
```

Keep project publish locks under Phase 5 unfinished.

- [ ] **Step 3: Update infra and test READMEs**

Modify `infra/nginx/README.md`:

```md
# Nginx

`zipship.conf` 是 ZipShip 访问面模板。

测试会替换：

- `__ZIPSHIP_LISTEN_PORT__`
- `__ZIPSHIP_SITES_ROOT__`
- `__ZIPSHIP_CONSOLE_ROOT__`
- `__ZIPSHIP_API_UPSTREAM__`
- `__ZIPSHIP_NGINX_PID__`

本阶段支持：

- `/:slug/` 当前正式版本
- `/:slug/:releaseHash/` 指定测试版本
- `/_api/` API upstream
- `/_console/` Console app
- `/_sites/` 内部预览 upstream
```

Modify `tests/README.md`:

```md
- `nginx/`：Nginx 访问面 routing tests；本机没有 nginx 时测试会 skip。
```

- [ ] **Step 4: Run focused tests**

Run:

```bash
bun test tests/unit/storage-static.test.ts tests/unit/uploads-routes.test.ts tests/unit/deployments-routes.test.ts tests/unit/site-preview-routes.test.ts
bun test tests/nginx
```

Expected:

- Unit/API tests pass.
- Nginx tests pass when nginx exists, or skip cleanly when nginx is unavailable.

- [ ] **Step 5: Run full verification**

Run:

```bash
bun test
bun test --coverage
bun run typecheck
bun run db:generate
codegraph sync .
```

Expected:

- `bun test` exits with code 0.
- `bun test --coverage` exits with code 0.
- `bun run typecheck` exits with code 0.
- `bun run db:generate` reports no schema changes.
- `codegraph sync .` exits with code 0.

- [ ] **Step 6: Check for untracked junk and do not touch CLAUDE.md**

Run:

```bash
git status --short --branch
git ls-files --others --exclude-standard
find . \( -name '.DS_Store' -o -name '.env.local' -o -name '.tmp-*' -o -name '*.tgz' \) -print
```

Expected:

- No untracked junk.
- `CLAUDE.md` may still be modified from outside this plan; do not stage it.

- [ ] **Step 7: Commit docs**

```bash
git add docs/02-技术架构.md docs/03-测试规范与实施路线.md infra/nginx/README.md tests/README.md
git commit -m "docs: document nginx access plane"
```

---

## Final Review Checklist For Deepseek-Flash

- [ ] Every task began with a failing test and the failure was observed.
- [ ] Artifact paths use `project.slug`, not `project.id`.
- [ ] `release.storagePath` points to `sites/:projectSlug/releases/:releaseHash`.
- [ ] Publish switches `current -> releases/:hash` before repository mutation.
- [ ] Rollback switches `current -> releases/:hash` before repository mutation.
- [ ] Symlink target is relative, not absolute.
- [ ] `current.tmp` is not left behind after repeated switches.
- [ ] Filesystem failures return stable codes and leave DB current unchanged.
- [ ] `/_sites` internal preview still works.
- [ ] Nginx tests pass or skip cleanly when nginx is unavailable.
- [ ] No new npm dependencies were added.
- [ ] `CLAUDE.md` was not staged or committed.
- [ ] Full verification passed.
