# Upload Processing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect raw zip upload and `@zipship/deploy-core` processing so `complete` can produce `ready` or `failed` releases.

**Architecture:** Add a local file storage adapter, extend upload task statuses, and introduce a release-processing service that calls `processRelease()`. Keep processing synchronous in this phase so API behavior is deterministic and easy to test; later job execution can reuse the same service.

**Tech Stack:** Bun, Elysia 1.4.29, `@elysia/eden` Treaty tests, TypeBox via `elysia.t`, `@zipship/deploy-core`, `@zipship/storage`, in-memory repository.

## Global Constraints

- Use the existing Elysia feature-module style: `model.ts`, `service.ts`, `index.ts`.
- API tests must use `@elysia/eden` Treaty.
- Backend errors must be stable English codes only, not localized display copy.
- Use root env via `@zipship/config`; do not add app-local env files.
- Keep package versions in root Bun Catalogs.
- Do not implement Nginx routing, publish, rollback, job queues, or PostgreSQL repositories in this plan.
- Do not commit generated temp folders, `.DS_Store`, `.codegraph/`, `.superpowers/`, `node_modules`, or Electron `out`.

---

## File Map

- Modify: `packages/storage/src/index.ts`
  - Add local storage helpers for upload raw zip writes and release/temp path creation.
- Modify: `apps/api/src/index.ts`
  - Accept optional test overrides and wire storage paths into modules.
- Modify: `apps/api/src/modules/uploads/model.ts`
  - Add upload body schema, upload success schema, new statuses, and stable error codes.
- Modify: `apps/api/src/modules/uploads/service.ts`
  - Add raw upload permission checks and storage/repository calls.
- Modify: `apps/api/src/modules/uploads/index.ts`
  - Add `PUT /_api/uploads/:uploadTaskId/raw`; call release processing from `complete`.
- Create: `apps/api/src/modules/release-processing/model.ts`
  - Define stable processing error codes and result DTO types.
- Create: `apps/api/src/modules/release-processing/service.ts`
  - Use `processRelease()` to update release/upload task state.
- Modify: `apps/api/src/modules/auth/repository.ts`
  - Extend in-memory repository methods for raw-uploaded, completed, and failed states.
- Modify: `tests/unit/uploads-routes.test.ts`
  - Cover raw upload and complete-to-ready/failed flows.
- Modify: `tests/unit/releases-routes.test.ts`
  - Assert release list returns real processing output.
- Modify: `docs/02-技术架构.md`
  - Update upload flow to mention raw upload route and synchronous local processing for this phase.
- Modify: `docs/03-测试规范与实施路线.md`
  - Mark raw zip upload and deploy-core processing as the next Phase 3 slice.

---

### Task 1: Local Storage Adapter

**Files:**
- Modify: `packages/storage/src/index.ts`
- Test: `packages/storage/src/index.ts` through API tests in later tasks

**Interfaces:**
- Produces:
  - `createStoragePaths(root: string): StoragePaths`
  - `createUploadRawPath(paths: StoragePaths, input: { projectId: string; uploadTaskId: string; filename: string }): string`
  - `createUploadWorkDir(paths: StoragePaths, uploadTaskId: string): string`
  - `createReleaseStoragePath(paths: StoragePaths, input: { projectId: string; releaseHash: string }): string`
  - `writeFileToPath(file: File, absolutePath: string): Promise<{ size: number }>`

- [ ] **Step 1: Extend storage helpers**

Replace `packages/storage/src/index.ts` with:

```ts
import { mkdir } from "fs/promises";
import { dirname, join } from "path";

export interface StoragePaths {
  uploadsRoot: string;
  tempRoot: string;
  sitesRoot: string;
}

export function createStoragePaths(root: string): StoragePaths {
  return {
    uploadsRoot: join(root, "uploads"),
    tempRoot: join(root, "temp"),
    sitesRoot: join(root, "sites"),
  };
}

export function createUploadRawPath(
  paths: StoragePaths,
  input: {
    projectId: string;
    uploadTaskId: string;
    filename: string;
  },
): string {
  return join(paths.uploadsRoot, "raw", input.projectId, input.uploadTaskId, input.filename);
}

export function createUploadWorkDir(paths: StoragePaths, uploadTaskId: string): string {
  return join(paths.tempRoot, uploadTaskId);
}

export function createReleaseStoragePath(
  paths: StoragePaths,
  input: {
    projectId: string;
    releaseHash: string;
  },
): string {
  return join(paths.sitesRoot, input.projectId, "releases", input.releaseHash);
}

export async function writeFileToPath(file: File, absolutePath: string): Promise<{ size: number }> {
  await mkdir(dirname(absolutePath), { recursive: true });
  await Bun.write(absolutePath, file);

  return {
    size: file.size,
  };
}
```

- [ ] **Step 2: Run storage typecheck**

Run: `bun run --filter @zipship/storage typecheck`

Expected: exits with code 0.

- [ ] **Step 3: Commit**

```bash
git add packages/storage/src/index.ts
git commit -m "feat: add local artifact storage helpers"
```

---

### Task 2: Upload Raw Zip Route

**Files:**
- Modify: `apps/api/src/index.ts`
- Modify: `apps/api/src/modules/uploads/model.ts`
- Modify: `apps/api/src/modules/uploads/service.ts`
- Modify: `apps/api/src/modules/uploads/index.ts`
- Modify: `apps/api/src/modules/auth/repository.ts`
- Modify: `tests/unit/uploads-routes.test.ts`

**Interfaces:**
- Consumes:
  - `createStoragePaths()`
  - `createUploadRawPath()`
  - `writeFileToPath()`
- Produces:
  - `PUT /_api/uploads/:uploadTaskId/raw`
  - `UploadsRepository.markUploadTaskUploaded(input): Promise<UploadTask>`
  - upload task status union includes `"uploading"`

- [ ] **Step 1: Write failing Eden test for raw zip upload**

Add to `tests/unit/uploads-routes.test.ts`:

```ts
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

function createTempStorageRoot() {
  return mkdtempSync(join(tmpdir(), "zipship-api-upload-"));
}

test("uploads raw zip bytes for an upload task", async () => {
  const storageRoot = createTempStorageRoot();
  try {
    const api = treaty(createApp({ storageRoot }));
    const { refreshToken, project } = await registerLoginAndCreateProject(api);
    const created = await api._api.projects({ projectId: project.id }).uploads.post(
      {
        originalFilename: "dist.zip",
        size: 1024,
      },
      {
        headers: {
          authorization: `Bearer ${refreshToken}`,
        },
      },
    );
    const uploadTask = created.data?.uploadTask;

    if (!uploadTask) throw new Error("Upload task creation unexpectedly returned no task");

    const bytes = await Bun.file(join(import.meta.dir, "../../packages/deploy-core/tests/fixtures/valid-vite-relative-base.zip")).arrayBuffer();
    const response = await api._api.uploads({ uploadTaskId: uploadTask.id }).raw.put(
      {
        file: new File([bytes], "dist.zip", { type: "application/zip" }),
      },
      {
        headers: {
          authorization: `Bearer ${refreshToken}`,
        },
      },
    );

    expect(response.status).toBe(200);
    expect(response.data?.uploadTask).toMatchObject({
      id: uploadTask.id,
      status: "uploading",
      errorMessage: null,
    });
  } finally {
    rmSync(storageRoot, { recursive: true, force: true });
  }
});
```

If existing helpers create their own `api`, refactor them to accept an optional API instance:

```ts
async function registerLoginAndCreateProject(api = treaty(createApp())) {
  // keep existing body, but remove local `const api = ...`
}
```

- [ ] **Step 2: Run test and verify failure**

Run: `bun test tests/unit/uploads-routes.test.ts`

Expected: FAIL because `.raw.put` route does not exist.

- [ ] **Step 3: Extend upload model**

In `apps/api/src/modules/uploads/model.ts`, update:

```ts
export const uploadTaskModel = t.Object({
  id: t.String(),
  projectId: t.String(),
  releaseId: t.Nullable(t.String()),
  status: t.Union([
    t.Literal("pending"),
    t.Literal("uploading"),
    t.Literal("processing"),
    t.Literal("completed"),
    t.Literal("failed"),
  ]),
  rawUploadPath: t.String(),
  originalFilename: t.String(),
  size: t.Number(),
  errorMessage: t.Nullable(t.String()),
  createdBy: t.String(),
  createdAt: t.String(),
  startedAt: t.Nullable(t.String()),
  finishedAt: t.Nullable(t.String()),
});

export const uploadRawBodyModel = t.Object({
  file: t.File({
    maxSize: "512m",
  }),
});

export const uploadModels = {
  "Uploads.Headers": uploadHeadersModel,
  "Uploads.Params": uploadParamsModel,
  "Uploads.DetailParams": uploadDetailParamsModel,
  "Uploads.CreateBody": createUploadTaskBodyModel,
  "Uploads.RawBody": uploadRawBodyModel,
  "Uploads.CreateSuccess": createUploadTaskSuccessModel,
  "Uploads.Detail": uploadTaskDetailModel,
  "Uploads.Error": uploadErrorModel,
};

export type UploadRawBody = typeof uploadRawBodyModel.static;
```

Add error code literals:

```ts
t.Literal("UPLOAD_TASK_NOT_PENDING"),
t.Literal("UPLOAD_TASK_NOT_UPLOADING"),
t.Literal("RAW_UPLOAD_REQUIRED"),
t.Literal("INVALID_UPLOAD_INPUT"),
```

Keep existing codes.

- [ ] **Step 4: Extend repository interface and service**

In `apps/api/src/modules/uploads/service.ts`, add:

```ts
import type { StoragePaths } from "@zipship/storage";
import { createUploadRawPath, writeFileToPath } from "@zipship/storage";
```

Extend `UploadsRepository`:

```ts
markUploadTaskUploaded(input: {
  uploadTaskId: string;
  rawUploadPath: string;
  size: number;
}): Promise<UploadTask>;
```

Extend `UploadsServiceOptions`:

```ts
storagePaths: StoragePaths;
```

Add method:

```ts
async uploadRaw(
  headers: UploadHeaders,
  params: UploadDetailParams,
  body: UploadRawBody,
): Promise<UploadTaskDetail | UploadServiceError> {
  const currentUser = await this.requireCurrentUser(headers);

  if (currentUser instanceof UploadServiceError) return currentUser;

  const uploadTask = await this.options.repository.findUploadTaskById(params.uploadTaskId);

  if (!uploadTask) return new UploadTaskNotFoundError();
  if (uploadTask.status !== "pending" && uploadTask.status !== "uploading") return new UploadTaskNotPendingError();

  const project = await this.options.repository.findProjectById(uploadTask.projectId);

  if (!project) return new UploadProjectNotFoundError();

  const membership = await this.options.repository.findMembership({
    organizationId: project.organizationId,
    userId: currentUser.user.id,
  });

  if (!membership) return new UploadForbiddenError();
  if (!this.permissions.can(membership.role, "upload_release")) return new UploadForbiddenError();

  const rawUploadPath = createUploadRawPath(this.options.storagePaths, {
    projectId: project.id,
    uploadTaskId: uploadTask.id,
    filename: uploadTask.originalFilename,
  });

  const written = await writeFileToPath(body.file, rawUploadPath);

  return {
    uploadTask: await this.options.repository.markUploadTaskUploaded({
      uploadTaskId: uploadTask.id,
      rawUploadPath,
      size: written.size,
    }),
  };
}
```

- [ ] **Step 5: Wire route**

In `apps/api/src/modules/uploads/index.ts`, extend module options:

```ts
import type { StoragePaths } from "@zipship/storage";

export interface UploadsModuleOptions {
  repository: UploadsRepository;
  hashRefreshToken: (token: string) => Promise<string>;
  storagePaths: StoragePaths;
}
```

Pass `storagePaths` to each `UploadsService`.

In `uploadDetailsModule`, add before `/complete`:

```ts
.put(
  "/raw",
  async ({ body, headers, params, status }) => {
    const result = await uploads.uploadRaw(headers, params, body);

    if (result instanceof UploadServiceError) {
      return status(toCompleteStatusCode(result.code), { code: result.code });
    }

    return result;
  },
  {
    headers: "Uploads.Headers",
    params: "Uploads.DetailParams",
    body: "Uploads.RawBody",
    response: {
      200: "Uploads.Detail",
      400: "Uploads.Error",
      401: "Uploads.Error",
      403: "Uploads.Error",
      404: "Uploads.Error",
      409: "Uploads.Error",
    },
  },
)
```

- [ ] **Step 6: Wire app storage paths**

In `apps/api/src/index.ts`:

```ts
import { createStoragePaths } from "@zipship/storage";

export interface CreateAppOptions {
  storageRoot?: string;
}

export function createApp(options: CreateAppOptions = {}) {
  const repository = createInMemoryAuthRepository();
  const storagePaths = createStoragePaths(options.storageRoot ?? config.storageRoot);

  return new Elysia()
    // existing modules
    .use(uploadsModule({ repository, hashRefreshToken, storagePaths }))
    .use(uploadDetailsModule({ repository, hashRefreshToken, storagePaths }));
}
```

- [ ] **Step 7: Implement in-memory state transition**

In `apps/api/src/modules/auth/repository.ts`, update `UploadTaskRecord.status` union to:

```ts
status: "pending" | "uploading" | "processing" | "completed" | "failed";
```

Add repository method:

```ts
async markUploadTaskUploaded(input) {
  const uploadTask = uploadTasks.get(input.uploadTaskId);

  if (!uploadTask) {
    throw new Error("Upload task not found");
  }

  uploadTask.status = "uploading";
  uploadTask.rawUploadPath = input.rawUploadPath;
  uploadTask.size = input.size;
  uploadTasks.set(uploadTask.id, uploadTask);

  return toUploadTask(uploadTask);
},
```

- [ ] **Step 8: Verify and commit**

Run:

```bash
bun test tests/unit/uploads-routes.test.ts
bun run typecheck
```

Expected: both pass.

Commit:

```bash
git add apps/api/src/index.ts apps/api/src/modules/uploads apps/api/src/modules/auth/repository.ts packages/storage/src/index.ts tests/unit/uploads-routes.test.ts
git commit -m "feat: upload raw zip artifacts"
```

---

### Task 3: Release Processing Service

**Files:**
- Create: `apps/api/src/modules/release-processing/model.ts`
- Create: `apps/api/src/modules/release-processing/service.ts`
- Modify: `apps/api/src/modules/uploads/index.ts`
- Modify: `apps/api/src/modules/uploads/service.ts`
- Modify: `apps/api/src/modules/auth/repository.ts`
- Modify: `tests/unit/uploads-routes.test.ts`

**Interfaces:**
- Consumes:
  - `processRelease(options): Promise<ReleaseResult>`
  - `createUploadWorkDir()`
  - `createReleaseStoragePath()`
- Produces:
  - `ReleaseProcessingService.processUploadTask(uploadTaskId: string): Promise<ReleaseProcessingResult>`
  - `UploadsRepository.completeProcessedRelease(input): Promise<UploadTask>`
  - `UploadsRepository.failProcessedRelease(input): Promise<UploadTask>`

- [ ] **Step 1: Write failing test for complete-to-ready**

Add to `tests/unit/uploads-routes.test.ts`:

```ts
test("completes an uploaded zip and marks its release ready", async () => {
  const storageRoot = createTempStorageRoot();
  try {
    const api = treaty(createApp({ storageRoot }));
    const { refreshToken, project } = await registerLoginAndCreateProject(api);
    const created = await api._api.projects({ projectId: project.id }).uploads.post(
      {
        originalFilename: "dist.zip",
        size: 1024,
      },
      {
        headers: {
          authorization: `Bearer ${refreshToken}`,
        },
      },
    );
    const uploadTask = created.data?.uploadTask;

    if (!uploadTask) throw new Error("Upload task creation unexpectedly returned no task");

    const bytes = await Bun.file(join(import.meta.dir, "../../packages/deploy-core/tests/fixtures/valid-vite-relative-base.zip")).arrayBuffer();
    await api._api.uploads({ uploadTaskId: uploadTask.id }).raw.put(
      {
        file: new File([bytes], "dist.zip", { type: "application/zip" }),
      },
      {
        headers: {
          authorization: `Bearer ${refreshToken}`,
        },
      },
    );

    const completed = await api._api.uploads({ uploadTaskId: uploadTask.id }).complete.post(null, {
      headers: {
        authorization: `Bearer ${refreshToken}`,
      },
    });

    expect(completed.status).toBe(200);
    expect(completed.data?.uploadTask).toMatchObject({
      id: uploadTask.id,
      status: "completed",
      errorMessage: null,
    });

    const releases = await api._api.projects({ projectId: project.id }).releases.get({
      headers: {
        authorization: `Bearer ${refreshToken}`,
      },
    });

    expect(releases.data?.releases[0]).toMatchObject({
      status: "ready",
      releaseHash: expect.any(String),
      fullHash: expect.any(String),
      fileCount: expect.any(Number),
      totalSize: expect.any(Number),
      detectResult: {
        level: "pass",
      },
    });
    expect(releases.data?.releases[0]?.releaseHash).toHaveLength(12);
  } finally {
    rmSync(storageRoot, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Write failing test for complete without raw upload**

Add:

```ts
test("rejects completing before raw zip upload exists", async () => {
  const storageRoot = createTempStorageRoot();
  try {
    const api = treaty(createApp({ storageRoot }));
    const { refreshToken, project } = await registerLoginAndCreateProject(api);
    const created = await api._api.projects({ projectId: project.id }).uploads.post(
      {
        originalFilename: "dist.zip",
        size: 1024,
      },
      {
        headers: {
          authorization: `Bearer ${refreshToken}`,
        },
      },
    );
    const uploadTask = created.data?.uploadTask;

    if (!uploadTask) throw new Error("Upload task creation unexpectedly returned no task");

    const response = await api._api.uploads({ uploadTaskId: uploadTask.id }).complete.post(null, {
      headers: {
        authorization: `Bearer ${refreshToken}`,
      },
    });

    expect(response.status).toBe(409);
    expect((response.error?.value as unknown)).toEqual({
      code: "RAW_UPLOAD_REQUIRED",
    });
  } finally {
    rmSync(storageRoot, { recursive: true, force: true });
  }
});
```

- [ ] **Step 3: Run tests and verify failure**

Run: `bun test tests/unit/uploads-routes.test.ts`

Expected: FAIL because processing service and error mapping do not exist.

- [ ] **Step 4: Add processing model**

Create `apps/api/src/modules/release-processing/model.ts`:

```ts
export type ReleaseProcessingErrorCode =
  | "RAW_UPLOAD_REQUIRED"
  | "DEPLOY_CORE_FAILED"
  | "DETECT_FAILED"
  | "RELEASE_NOT_FOUND"
  | "UPLOAD_TASK_NOT_FOUND";

export class ReleaseProcessingError {
  constructor(
    public readonly code: ReleaseProcessingErrorCode,
    public readonly details: Record<string, unknown> = {},
  ) {}
}

export interface ReleaseProcessingSuccess {
  status: "ready";
}

export type ReleaseProcessingResult = ReleaseProcessingSuccess | ReleaseProcessingError;
```

- [ ] **Step 5: Add processing repository interface and service**

Create `apps/api/src/modules/release-processing/service.ts`:

```ts
import { mkdir, rm } from "fs/promises";
import { existsSync } from "fs";
import { processRelease, DeployCoreError } from "@zipship/deploy-core";
import type { StoragePaths } from "@zipship/storage";
import { createReleaseStoragePath, createUploadWorkDir } from "@zipship/storage";
import { ReleaseProcessingError } from "./model";
import type { ReleaseProcessingResult } from "./model";
import type { UploadTask } from "../uploads/model";

export interface ReleaseProcessingRepository {
  findUploadTaskById(uploadTaskId: string): Promise<UploadTask | null>;
  completeProcessedRelease(input: {
    uploadTaskId: string;
    releaseId: string;
    releaseHash: string;
    fullHash: string;
    storagePath: string;
    fileCount: number;
    totalSize: number;
    manifest: Record<string, unknown>;
    detectResult: Record<string, unknown>;
    finishedAt: Date;
  }): Promise<UploadTask>;
  failProcessedRelease(input: {
    uploadTaskId: string;
    releaseId: string;
    errorCode: string;
    detectResult: Record<string, unknown>;
    finishedAt: Date;
  }): Promise<UploadTask>;
}

export interface ReleaseProcessingServiceOptions {
  repository: ReleaseProcessingRepository;
  storagePaths: StoragePaths;
  now: () => Date;
}

export class ReleaseProcessingService {
  constructor(private readonly options: ReleaseProcessingServiceOptions) {}

  async processUploadTask(uploadTaskId: string): Promise<ReleaseProcessingResult> {
    const uploadTask = await this.options.repository.findUploadTaskById(uploadTaskId);

    if (!uploadTask) return new ReleaseProcessingError("UPLOAD_TASK_NOT_FOUND");
    if (!uploadTask.releaseId) return new ReleaseProcessingError("RELEASE_NOT_FOUND");
    if (!existsSync(uploadTask.rawUploadPath)) return new ReleaseProcessingError("RAW_UPLOAD_REQUIRED");

    const workDir = createUploadWorkDir(this.options.storagePaths, uploadTask.id);

    await rm(workDir, { recursive: true, force: true });
    await mkdir(workDir, { recursive: true });

    try {
      const result = await processRelease({
        zipPath: uploadTask.rawUploadPath,
        workDir,
      });

      const releaseStoragePath = createReleaseStoragePath(this.options.storagePaths, {
        projectId: uploadTask.projectId,
        releaseHash: result.manifest.releaseHash,
      });
      const totalSize = result.manifest.files.reduce((sum, file) => sum + file.size, 0);

      if (result.detect.level === "failed") {
        await this.options.repository.failProcessedRelease({
          uploadTaskId: uploadTask.id,
          releaseId: uploadTask.releaseId,
          errorCode: "DETECT_FAILED",
          detectResult: result.detect as unknown as Record<string, unknown>,
          finishedAt: this.options.now(),
        });

        return new ReleaseProcessingError("DETECT_FAILED", {
          releaseId: uploadTask.releaseId,
        });
      }

      await this.options.repository.completeProcessedRelease({
        uploadTaskId: uploadTask.id,
        releaseId: uploadTask.releaseId,
        releaseHash: result.manifest.releaseHash,
        fullHash: result.manifest.hash,
        storagePath: releaseStoragePath,
        fileCount: result.manifest.files.length,
        totalSize,
        manifest: result.manifest as unknown as Record<string, unknown>,
        detectResult: result.detect as unknown as Record<string, unknown>,
        finishedAt: this.options.now(),
      });

      return {
        status: "ready",
      };
    } catch (error) {
      const errorCode = error instanceof DeployCoreError ? `DEPLOY_CORE:${error.code}` : "DEPLOY_CORE_FAILED";

      await this.options.repository.failProcessedRelease({
        uploadTaskId: uploadTask.id,
        releaseId: uploadTask.releaseId,
        errorCode,
        detectResult: {
          level: "failed",
          items: [
            {
              level: "failed",
              code: errorCode,
            },
          ],
        },
        finishedAt: this.options.now(),
      });

      return new ReleaseProcessingError("DEPLOY_CORE_FAILED", {
        errorCode,
      });
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  }
}
```

- [ ] **Step 6: Extend repository methods**

In `apps/api/src/modules/auth/repository.ts`, implement:

```ts
async completeProcessedRelease(input) {
  const uploadTask = uploadTasks.get(input.uploadTaskId);
  const release = releases.get(input.releaseId);

  if (!uploadTask) throw new Error("Upload task not found");
  if (!release) throw new Error("Release not found");

  release.status = "ready";
  release.releaseHash = input.releaseHash;
  release.fullHash = input.fullHash;
  release.storagePath = input.storagePath;
  release.fileCount = input.fileCount;
  release.totalSize = input.totalSize;
  release.manifest = input.manifest;
  release.detectResult = input.detectResult;
  releases.set(release.id, release);

  uploadTask.status = "completed";
  uploadTask.errorMessage = null;
  uploadTask.finishedAt = input.finishedAt;
  uploadTasks.set(uploadTask.id, uploadTask);

  return toUploadTask(uploadTask);
},

async failProcessedRelease(input) {
  const uploadTask = uploadTasks.get(input.uploadTaskId);
  const release = releases.get(input.releaseId);

  if (!uploadTask) throw new Error("Upload task not found");
  if (!release) throw new Error("Release not found");

  release.status = "failed";
  release.detectResult = input.detectResult;
  releases.set(release.id, release);

  uploadTask.status = "failed";
  uploadTask.errorMessage = input.errorCode;
  uploadTask.finishedAt = input.finishedAt;
  uploadTasks.set(uploadTask.id, uploadTask);

  return toUploadTask(uploadTask);
},
```

Also widen `ReleaseRecord.status` to:

```ts
status: "processing" | "ready" | "failed";
```

- [ ] **Step 7: Call processing from complete**

In `apps/api/src/modules/uploads/index.ts`, create `ReleaseProcessingService` inside `uploadDetailsModule`:

```ts
const releaseProcessing = new ReleaseProcessingService({
  repository: options.repository,
  storagePaths: options.storagePaths,
  now: () => new Date(),
});
```

After `uploads.complete()` succeeds:

```ts
const processingResult = await releaseProcessing.processUploadTask(result.uploadTask.id);

if (processingResult instanceof ReleaseProcessingError) {
  if (processingResult.code === "RAW_UPLOAD_REQUIRED") {
    return status(409, { code: "RAW_UPLOAD_REQUIRED" as const });
  }
}

const refreshed = await uploads.get(headers, params);

if (refreshed instanceof UploadServiceError) {
  return status(toCompleteStatusCode(refreshed.code), { code: refreshed.code });
}

return refreshed;
```

Import:

```ts
import { ReleaseProcessingError } from "../release-processing/model";
import { ReleaseProcessingService } from "../release-processing/service";
```

- [ ] **Step 8: Update complete precondition**

In `UploadsService.complete()`, require `uploadTask.status === "uploading"` instead of `"pending"`:

```ts
if (uploadTask.status !== "uploading") return new RawUploadRequiredError();
```

Add `RawUploadRequiredError extends UploadServiceError` in `model.ts` with code `"RAW_UPLOAD_REQUIRED"`.

Update `toCompleteStatusCode()`:

```ts
if (code === "RAW_UPLOAD_REQUIRED") return 409;
if (code === "UPLOAD_TASK_NOT_PENDING") return 409;
```

- [ ] **Step 9: Verify and commit**

Run:

```bash
bun test tests/unit/uploads-routes.test.ts
bun test tests/unit/releases-routes.test.ts
bun run typecheck
```

Expected: all pass.

Commit:

```bash
git add apps/api/src/modules/release-processing apps/api/src/modules/uploads apps/api/src/modules/auth/repository.ts tests/unit/uploads-routes.test.ts tests/unit/releases-routes.test.ts
git commit -m "feat: process uploaded releases"
```

---

### Task 4: Failed Detection Flow

**Files:**
- Modify: `tests/unit/uploads-routes.test.ts`
- Modify: `apps/api/src/modules/uploads/index.ts`
- Modify: `apps/api/src/modules/uploads/model.ts`
- Modify: `apps/api/src/modules/release-processing/service.ts`

**Interfaces:**
- Consumes:
  - `ReleaseProcessingError("DETECT_FAILED")`
- Produces:
  - complete route returns 200 with failed upload task when deploy-core detection fails
  - release list exposes failed detect result

- [ ] **Step 1: Write failing failed-detection test**

Add:

```ts
test("marks release failed when deploy-core detection fails", async () => {
  const storageRoot = createTempStorageRoot();
  try {
    const api = treaty(createApp({ storageRoot }));
    const { refreshToken, project } = await registerLoginAndCreateProject(api);
    const created = await api._api.projects({ projectId: project.id }).uploads.post(
      {
        originalFilename: "dist.zip",
        size: 1024,
      },
      {
        headers: {
          authorization: `Bearer ${refreshToken}`,
        },
      },
    );
    const uploadTask = created.data?.uploadTask;

    if (!uploadTask) throw new Error("Upload task creation unexpectedly returned no task");

    const bytes = await Bun.file(join(import.meta.dir, "../../packages/deploy-core/tests/fixtures/dot-env.zip")).arrayBuffer();
    await api._api.uploads({ uploadTaskId: uploadTask.id }).raw.put(
      {
        file: new File([bytes], "dist.zip", { type: "application/zip" }),
      },
      {
        headers: {
          authorization: `Bearer ${refreshToken}`,
        },
      },
    );

    const completed = await api._api.uploads({ uploadTaskId: uploadTask.id }).complete.post(null, {
      headers: {
        authorization: `Bearer ${refreshToken}`,
      },
    });

    expect(completed.status).toBe(200);
    expect(completed.data?.uploadTask).toMatchObject({
      status: "failed",
      errorMessage: "DETECT_FAILED",
    });

    const releases = await api._api.projects({ projectId: project.id }).releases.get({
      headers: {
        authorization: `Bearer ${refreshToken}`,
      },
    });

    expect(releases.data?.releases[0]).toMatchObject({
      status: "failed",
      detectResult: {
        level: "failed",
      },
    });
  } finally {
    rmSync(storageRoot, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Ensure route returns refreshed task for failed processing**

In `uploads/index.ts`, do not convert `DETECT_FAILED` into an HTTP error. The `complete` route should return 200 with the refreshed failed upload task, because the request itself succeeded and the artifact failed validation.

Use:

```ts
if (processingResult instanceof ReleaseProcessingError && processingResult.code === "RAW_UPLOAD_REQUIRED") {
  return status(409, { code: "RAW_UPLOAD_REQUIRED" as const });
}
```

All other processing errors should be persisted to release/upload task and returned via refreshed detail.

- [ ] **Step 3: Verify and commit**

Run:

```bash
bun test tests/unit/uploads-routes.test.ts
bun run typecheck
```

Expected: both pass.

Commit:

```bash
git add apps/api/src/modules/uploads apps/api/src/modules/release-processing tests/unit/uploads-routes.test.ts
git commit -m "feat: persist failed release detection"
```

---

### Task 5: Release List Contract and Docs

**Files:**
- Modify: `tests/unit/releases-routes.test.ts`
- Modify: `apps/api/src/modules/releases/model.ts`
- Modify: `docs/02-技术架构.md`
- Modify: `docs/03-测试规范与实施路线.md`

**Interfaces:**
- Consumes:
  - release records updated by processing service
- Produces:
  - release list contract includes ready/failed status, manifest, detect result, true hash fields

- [ ] **Step 1: Update release list tests**

In `tests/unit/releases-routes.test.ts`, update the existing completed-upload helper to upload raw bytes before complete. Then assert:

```ts
expect(release).toMatchObject({
  projectId: project.id,
  versionNumber: 1,
  status: "ready",
  releaseHash: expect.any(String),
  fullHash: expect.any(String),
  fileCount: expect.any(Number),
  totalSize: expect.any(Number),
  manifest: {
    version: 1,
    hashAlgorithm: "sha256",
  },
  detectResult: {
    level: "pass",
  },
  activatedAt: null,
  archivedAt: null,
});
expect(release?.releaseHash).toHaveLength(12);
```

- [ ] **Step 2: Confirm response model allows deploy-core result shapes**

In `apps/api/src/modules/releases/model.ts`, keep:

```ts
manifest: t.Record(t.String(), t.Unknown()),
detectResult: t.Record(t.String(), t.Unknown()),
```

No localized display text should be added.

- [ ] **Step 3: Update docs**

In `docs/02-技术架构.md`, update section `11. 上传处理流程` to include:

```txt
PUT /_api/uploads/:uploadTaskId/raw 保存 zip 到 storageRoot/uploads/raw
POST /_api/uploads/:uploadTaskId/complete 同步调用 deploy-core
检测通过：release ready，upload_task completed
检测失败：release failed，upload_task failed
```

In `docs/03-测试规范与实施路线.md`, under Phase 3, mark this slice as:

```txt
raw zip 上传 API
complete 同步处理 deploy-core
release ready / failed 状态持久化
release list 展示 manifest / detectResult
```

- [ ] **Step 4: Verify and commit**

Run:

```bash
bun test tests/unit/releases-routes.test.ts tests/unit/uploads-routes.test.ts
bun run typecheck
```

Expected: both pass.

Commit:

```bash
git add apps/api/src/modules/releases/model.ts tests/unit/releases-routes.test.ts docs/02-技术架构.md docs/03-测试规范与实施路线.md
git commit -m "docs: document release processing flow"
```

---

### Task 6: Final Verification

**Files:**
- No code files should change unless verification exposes a real issue.

- [ ] **Step 1: Run full verification**

Run:

```bash
bun test
bun run typecheck
bun run db:generate
bun --filter @zipship/desktop-shell lint
bun --filter @zipship/desktop-shell package
codegraph sync .
codegraph status .
```

Expected:

- `bun test`: all tests pass.
- `bun run typecheck`: all workspaces pass.
- `bun run db:generate`: no schema changes unless this plan intentionally changed schema. This plan should not change schema.
- desktop lint/package pass. Existing `inlineDynamicImports` warning is acceptable.
- CodeGraph status says index is up to date.

- [ ] **Step 2: Check for ignored/local artifacts**

Run:

```bash
git status --short --ignored | sed -n '1,160p'
find . -path './node_modules' -prune -o -path './apps/*/node_modules' -prune -o -path './packages/*/node_modules' -prune -o \( -name .DS_Store -o -path '*/tests/.tmp-*' \) -print
```

Expected:

- No untracked `.tmp-*`.
- No `.DS_Store`.
- Ignored entries may include `.codegraph/`, `.superpowers/`, `node_modules`, `.vite`, and Electron `out`.

- [ ] **Step 3: Final commit if verification required fixes**

If verification required fixes:

```bash
git add <changed-files>
git commit -m "fix: stabilize upload processing verification"
```

If no fixes were required, do not create an empty commit.

---

## Self-Review Checklist

- Spec coverage: raw upload, local storage, deploy-core processing, ready/failed release states, release list, docs, and verification are covered.
- Placeholder scan: no placeholder markers or unspecified “handle errors” steps remain.
- Scope check: Nginx, publish/rollback, async job queue, object storage, real DB repository, and frontend UI are intentionally out of scope.
- Type consistency: `UploadTask.status` matches the database enum; `releaseHash` is 12 chars from deploy-core for processed releases; backend errors remain stable codes.
