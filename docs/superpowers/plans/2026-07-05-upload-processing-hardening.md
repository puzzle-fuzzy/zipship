# Upload Processing Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden the upload-processing slice so tests prove raw zip persistence, real release artifact persistence, correct upload-task state transitions, and accurate documentation.

**Architecture:** Keep the current synchronous Elysia upload flow for this phase, but make `ready` mean the processed artifact exists under `storageRoot/sites/{projectId}/releases/{releaseHash}`. Preserve stable backend error codes, use Eden Treaty for route tests, and keep processing state changes deterministic by validating raw file availability before moving an upload task into `processing`.

**Tech Stack:** Bun, Elysia 1.4.29, `@elysia/eden` Treaty tests, TypeBox via `elysia.t`, `@zipship/deploy-core`, `@zipship/storage`, in-memory repository.

## Global Constraints

- **测试先行是硬要求：每个任务必须先写会失败的测试，先运行并确认失败，再改实现。**
- Do not start by changing implementation code. Tests must describe the desired behavior before the production code changes.
- API tests must use `@elysia/eden` Treaty unless the test is specifically exercising malformed HTTP bodies that Treaty cannot represent.
- Backend errors must be stable English codes only, not localized display copy.
- Follow the existing Elysia feature-module style: `model.ts`, `service.ts`, `index.ts`.
- Use root env via `@zipship/config`; do not add app-local env files.
- Keep package versions in root Bun Catalogs.
- Do not implement Nginx routing, publish, rollback, job queues, PostgreSQL repositories, or UI work in this plan.
- Do not commit generated temp folders, `.DS_Store`, `.codegraph/`, `.superpowers/`, `node_modules`, Electron `out`, or ad-hoc zip files outside committed test fixtures.
- After each task, commit only the files touched by that task.

---

## File Map

- Modify: `packages/storage/src/index.ts`
  - Add a small helper that copies the processed artifact root into the final release storage directory.
- Modify: `apps/api/src/modules/release-processing/service.ts`
  - Persist processed files before marking a release `ready`.
- Modify: `apps/api/src/modules/uploads/service.ts`
  - Return state-specific errors and prevent `complete` from moving missing raw files into `processing`.
- Modify: `apps/api/src/modules/uploads/index.ts`
  - Add validation error handling to upload detail routes if malformed raw upload bodies currently leak Elysia defaults.
- Modify: `apps/api/src/modules/uploads/model.ts`
  - Keep or reuse `UPLOAD_TASK_NOT_UPLOADING`; remove it only if every call site and test explicitly choose a different stable code.
- Modify: `tests/unit/uploads-routes.test.ts`
  - Strengthen route tests around raw persistence, ready artifact persistence, missing raw files, retry/duplicate state, and stable error codes.
- Modify: `tests/unit/releases-routes.test.ts`
  - Strengthen release-list assertions so metadata and artifact paths are meaningful, not just `expect.any`.
- Modify: `docs/02-技术架构.md`
  - Document the corrected local artifact persistence flow.
- Modify: `docs/03-测试规范与实施路线.md`
  - Mark only the actually completed Phase 3 capabilities; leave “返回测试地址” or serving flow as remaining work unless implemented.

---

### Task 1: Prove And Persist Ready Release Files

**Files:**
- Modify: `tests/unit/uploads-routes.test.ts`
- Modify: `tests/unit/releases-routes.test.ts`
- Modify: `packages/storage/src/index.ts`
- Modify: `apps/api/src/modules/release-processing/service.ts`

**Interfaces:**
- Consumes:
  - `processRelease(options): Promise<{ rootDir: string; files: FileEntry[]; detect: DetectResult; manifest: Manifest }>`
  - `createReleaseStoragePath(paths, { projectId, releaseHash }): string`
- Produces:
  - `copyDirectoryContents(sourceDir: string, destinationDir: string): Promise<void>`
  - A `ready` release whose `storagePath` exists and contains the processed artifact files.

- [ ] **Step 1: Write failing Eden test for final release artifact files**

Add these imports to `tests/unit/uploads-routes.test.ts` if they are not already present:

```ts
import { existsSync, readFileSync } from "fs";
```

In the existing `completes an uploaded zip and marks its release ready` test, after `const firstRelease = releases.data?.releases[0];`, strengthen the assertions to prove the file system result:

```ts
expect(firstRelease).toBeDefined();
if (!firstRelease) throw new Error("Expected a release after completing upload");

expect(firstRelease.status).toBe("ready");
expect(firstRelease.releaseHash).toEqual(expect.any(String));
expect(firstRelease.releaseHash).toHaveLength(12);
expect(firstRelease.fullHash).toEqual(expect.any(String));
expect(firstRelease.fullHash).toHaveLength(64);
expect(firstRelease.fileCount).toBeGreaterThan(0);
expect(firstRelease.totalSize).toBeGreaterThan(0);
expect(firstRelease.storagePath).toContain(storageRoot);
expect(firstRelease.storagePath).toContain(project.id);
expect(existsSync(firstRelease.storagePath)).toBe(true);
expect(existsSync(join(firstRelease.storagePath, "index.html"))).toBe(true);
expect(readFileSync(join(firstRelease.storagePath, "index.html"), "utf8")).toContain("./assets/index.js");

const manifest = firstRelease.manifest as {
  version: number;
  hashAlgorithm: string;
  files: Array<{ path: string; hash: string; size: number }>;
  hash: string;
  releaseHash: string;
};
expect(manifest.version).toBe(1);
expect(manifest.hashAlgorithm).toBe("sha256");
expect(manifest.releaseHash).toBe(firstRelease.releaseHash);
expect(manifest.hash).toBe(firstRelease.fullHash);
expect(manifest.files.some((file) => file.path === "index.html")).toBe(true);
expect(manifest.files.length).toBe(firstRelease.fileCount);
```

In `tests/unit/releases-routes.test.ts`, add `existsSync` to the imports and strengthen the release-list test after `const release = response.data?.releases[0];`:

```ts
expect(release).toBeDefined();
if (!release) throw new Error("Expected release list to contain the completed upload");

expect(release.releaseHash).toEqual(expect.any(String));
expect(release.releaseHash).toHaveLength(12);
expect(release.fullHash).toEqual(expect.any(String));
expect(release.fullHash).toHaveLength(64);
expect(release.status).toBe("ready");
expect(release.storagePath).toContain(storageRoot);
expect(release.storagePath).toContain(project.id);
expect(existsSync(release.storagePath)).toBe(true);
expect(existsSync(join(release.storagePath, "index.html"))).toBe(true);
expect(release.fileCount).toBeGreaterThan(0);
expect(release.totalSize).toBeGreaterThan(0);
expect((release.detectResult as { level: string }).level).toBe("pass");

const manifest = release.manifest as {
  version: number;
  hashAlgorithm: string;
  files: Array<{ path: string; hash: string; size: number }>;
  hash: string;
  releaseHash: string;
};
expect(manifest.version).toBe(1);
expect(manifest.hashAlgorithm).toBe("sha256");
expect(manifest.files.length).toBe(release.fileCount);
expect(manifest.releaseHash).toBe(release.releaseHash);
```

- [ ] **Step 2: Run tests to verify they fail before implementation**

Run:

```bash
bun test tests/unit/uploads-routes.test.ts tests/unit/releases-routes.test.ts
```

Expected: FAIL because `release.storagePath` does not exist or `index.html` is missing under the final release storage directory.

- [ ] **Step 3: Add storage copy helper**

Modify `packages/storage/src/index.ts`:

```ts
import { cp, mkdir, rm } from "fs/promises";
import { dirname, join } from "path";
```

Add this function at the end of the file:

```ts
export async function copyDirectoryContents(sourceDir: string, destinationDir: string): Promise<void> {
  await rm(destinationDir, { recursive: true, force: true });
  await mkdir(dirname(destinationDir), { recursive: true });
  await cp(sourceDir, destinationDir, {
    recursive: true,
    force: true,
    errorOnExist: false,
  });
}
```

- [ ] **Step 4: Persist processed artifact before marking release ready**

Modify the import in `apps/api/src/modules/release-processing/service.ts`:

```ts
import { copyDirectoryContents, createReleaseStoragePath, createUploadWorkDir } from "@zipship/storage";
```

After `const releaseStoragePath = createReleaseStoragePath(...)` and before `completeProcessedRelease(...)`, copy the artifact root returned by deploy-core:

```ts
await copyDirectoryContents(result.rootDir, releaseStoragePath);
```

The ready branch must remain in this order:

```ts
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

await copyDirectoryContents(result.rootDir, releaseStoragePath);

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
```

- [ ] **Step 5: Run tests to verify they pass**

Run:

```bash
bun test tests/unit/uploads-routes.test.ts tests/unit/releases-routes.test.ts
bun run --filter @zipship/storage typecheck
bun run --filter @zipship/api typecheck
```

Expected: all commands exit with code 0.

- [ ] **Step 6: Commit**

```bash
git add packages/storage/src/index.ts apps/api/src/modules/release-processing/service.ts tests/unit/uploads-routes.test.ts tests/unit/releases-routes.test.ts
git commit -m "fix: persist processed release artifacts"
```

---

### Task 2: Fix Complete State Errors And Missing Raw File Handling

**Files:**
- Modify: `tests/unit/uploads-routes.test.ts`
- Modify: `apps/api/src/modules/uploads/service.ts`
- Modify: `apps/api/src/modules/uploads/model.ts`

**Interfaces:**
- Consumes:
  - `UploadTask.status`
  - `UploadTask.rawUploadPath`
- Produces:
  - `complete` returns `RAW_UPLOAD_REQUIRED` only when an upload still needs raw bytes.
  - `complete` returns `UPLOAD_TASK_NOT_UPLOADING` when the task is already `completed`, `failed`, or `processing`.
  - Missing raw file after an upload does not move the task into `processing`.

- [ ] **Step 1: Write failing test for already-completed complete error**

In `tests/unit/uploads-routes.test.ts`, update the existing `rejects completing an upload task that is already completed` test:

```ts
expect(response.status).toBe(409);
expect((response.error?.value as unknown)).toEqual({
  code: "UPLOAD_TASK_NOT_UPLOADING",
});
```

- [ ] **Step 2: Write failing test for missing raw file after upload**

Add `unlinkSync` to the `fs` import:

```ts
import { existsSync, readFileSync, unlinkSync } from "fs";
```

Add this test near the existing `rejects completing before raw zip upload exists` test:

```ts
test("rejects complete when an uploaded raw zip is missing without moving to processing", async () => {
  const storageRoot = createTempStorageRoot();
  try {
    const api = treaty(createApp({ storageRoot }));
    const { refreshToken, project } = await registerLoginAndCreateProject(api);
    const created = await api._api.projects({ projectId: project.id }).uploads.post(
      { originalFilename: "dist.zip", size: 1024 },
      { headers: { authorization: `Bearer ${refreshToken}` } },
    );
    const uploadTask = created.data?.uploadTask;
    if (!uploadTask) throw new Error("Upload task creation unexpectedly returned no task");

    const bytes = await Bun.file(join(import.meta.dir, "../../packages/deploy-core/tests/fixtures/valid-vite-relative-base.zip")).arrayBuffer();
    const raw = await api._api.uploads({ uploadTaskId: uploadTask.id }).raw.put(
      { file: new File([bytes], "dist.zip", { type: "application/zip" }) },
      { headers: { authorization: `Bearer ${refreshToken}` } },
    );
    const rawPath = raw.data?.uploadTask.rawUploadPath;
    if (!rawPath) throw new Error("Raw upload unexpectedly returned no path");
    unlinkSync(rawPath);

    const response = await api._api.uploads({ uploadTaskId: uploadTask.id }).complete.post(null, {
      headers: { authorization: `Bearer ${refreshToken}` },
    });

    expect(response.status).toBe(409);
    expect((response.error?.value as unknown)).toEqual({ code: "RAW_UPLOAD_REQUIRED" });

    const detail = await api._api.uploads({ uploadTaskId: uploadTask.id }).get({
      headers: { authorization: `Bearer ${refreshToken}` },
    });
    expect(detail.status).toBe(200);
    expect(detail.data?.uploadTask.status).toBe("uploading");
    expect(detail.data?.uploadTask.releaseId).toBeNull();
  } finally {
    rmSync(storageRoot, { recursive: true, force: true });
  }
});
```

- [ ] **Step 3: Run tests to verify they fail before implementation**

Run:

```bash
bun test tests/unit/uploads-routes.test.ts
```

Expected: FAIL because completed uploads currently return `RAW_UPLOAD_REQUIRED`, and missing raw files are not checked at the upload-service boundary.

- [ ] **Step 4: Implement state-specific complete errors**

Modify imports in `apps/api/src/modules/uploads/service.ts`:

```ts
import { existsSync } from "fs";
import {
  InvalidUploadInputError,
  RawUploadRequiredError,
  UploadForbiddenError,
  UploadProjectNotFoundError,
  UploadServiceError,
  UploadTaskNotFoundError,
  UploadTaskNotPendingError,
  UploadTaskNotUploadingError,
  UploadUnauthorizedError,
} from "./model";
```

Replace this line:

```ts
if (uploadTask.status !== "uploading") return new RawUploadRequiredError();
```

with:

```ts
if (uploadTask.status === "pending") return new RawUploadRequiredError();
if (uploadTask.status !== "uploading") return new UploadTaskNotUploadingError();
if (!existsSync(uploadTask.rawUploadPath)) return new RawUploadRequiredError();
```

Keep `UploadTaskNotUploadingError` in `apps/api/src/modules/uploads/model.ts`; it is now intentionally used.

- [ ] **Step 5: Run tests to verify they pass**

Run:

```bash
bun test tests/unit/uploads-routes.test.ts
bun run --filter @zipship/api typecheck
```

Expected: all commands exit with code 0.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/uploads/service.ts apps/api/src/modules/uploads/model.ts tests/unit/uploads-routes.test.ts
git commit -m "fix: harden upload complete state handling"
```

---

### Task 3: Harden Raw Upload Route Coverage

**Files:**
- Modify: `tests/unit/uploads-routes.test.ts`
- Modify: `apps/api/src/modules/uploads/index.ts`
- Modify: `apps/api/src/modules/uploads/service.ts`

**Interfaces:**
- Consumes:
  - `PUT /_api/uploads/:uploadTaskId/raw`
- Produces:
  - Raw route tests for authorization, not-found, persisted bytes, completed-state rejection, and malformed body validation.
  - Stable validation error body `{ code: "VALIDATION_ERROR" }` for malformed raw upload bodies.

- [ ] **Step 1: Write failing or strengthening tests for raw upload behavior**

Add these tests to `tests/unit/uploads-routes.test.ts`.

Unauthorized raw upload:

```ts
test("returns unauthorized when uploading raw zip without a bearer token", async () => {
  const api = treaty(createApp());
  const response = await api._api.uploads({ uploadTaskId: "upload-task-1" }).raw.put({
    file: new File(["zip"], "dist.zip", { type: "application/zip" }),
  });

  expect(response.status).toBe(401);
  expect((response.error?.value as unknown)).toEqual({
    code: "UNAUTHORIZED",
  });
});
```

Unknown upload task:

```ts
test("returns not found when uploading raw zip for an unknown upload task", async () => {
  const { api, refreshToken } = await registerLoginAndCreateProject();

  const response = await api._api.uploads({ uploadTaskId: "missing-upload-task" }).raw.put(
    { file: new File(["zip"], "dist.zip", { type: "application/zip" }) },
    { headers: { authorization: `Bearer ${refreshToken}` } },
  );

  expect(response.status).toBe(404);
  expect((response.error?.value as unknown)).toEqual({
    code: "UPLOAD_TASK_NOT_FOUND",
  });
});
```

Persisted bytes:

```ts
test("writes raw zip bytes to the configured storage root", async () => {
  const storageRoot = createTempStorageRoot();
  try {
    const api = treaty(createApp({ storageRoot }));
    const { refreshToken, project } = await registerLoginAndCreateProject(api);
    const created = await api._api.projects({ projectId: project.id }).uploads.post(
      { originalFilename: "dist.zip", size: 1024 },
      { headers: { authorization: `Bearer ${refreshToken}` } },
    );
    const uploadTask = created.data?.uploadTask;
    if (!uploadTask) throw new Error("Upload task creation unexpectedly returned no task");

    const bytes = await Bun.file(join(import.meta.dir, "../../packages/deploy-core/tests/fixtures/valid-vite-relative-base.zip")).arrayBuffer();
    const response = await api._api.uploads({ uploadTaskId: uploadTask.id }).raw.put(
      { file: new File([bytes], "ignored-client-name.zip", { type: "application/zip" }) },
      { headers: { authorization: `Bearer ${refreshToken}` } },
    );

    const rawPath = response.data?.uploadTask.rawUploadPath;
    expect(response.status).toBe(200);
    expect(rawPath).toContain(storageRoot);
    expect(rawPath).toContain(project.id);
    expect(rawPath).toContain(uploadTask.id);
    expect(rawPath?.endsWith("/dist.zip")).toBe(true);
    expect(existsSync(rawPath ?? "")).toBe(true);
    expect(Bun.file(rawPath ?? "").size).toBe(bytes.byteLength);
  } finally {
    rmSync(storageRoot, { recursive: true, force: true });
  }
});
```

Raw upload after completed:

```ts
test("rejects raw upload after an upload task is completed", async () => {
  const storageRoot = createTempStorageRoot();
  try {
    const api = treaty(createApp({ storageRoot }));
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

    const response = await api._api.uploads({ uploadTaskId: uploadTask.id }).raw.put(
      { file: new File([bytes], "dist.zip", { type: "application/zip" }) },
      { headers: { authorization: `Bearer ${refreshToken}` } },
    );

    expect(response.status).toBe(409);
    expect((response.error?.value as unknown)).toEqual({
      code: "UPLOAD_TASK_NOT_PENDING",
    });
  } finally {
    rmSync(storageRoot, { recursive: true, force: true });
  }
});
```

Malformed raw body through `app.handle()`:

```ts
test("returns stable validation error for malformed raw upload bodies", async () => {
  const direct = createApp();
  const directApi = treaty(direct);
  const { refreshToken, uploadTask } = await registerLoginCreateProjectAndUploadTask(directApi);

  const response = await direct.handle(
    new Request(`http://localhost/_api/uploads/${uploadTask.id}/raw`, {
      method: "PUT",
      headers: {
        authorization: `Bearer ${refreshToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({}),
    }),
  );

  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({
    code: "VALIDATION_ERROR",
  });
});
```

- [ ] **Step 2: Run tests to verify failures before implementation**

Run:

```bash
bun test tests/unit/uploads-routes.test.ts
```

Expected: At least the malformed validation test should fail if `uploadDetailsModule` does not normalize validation errors. The other tests may already pass; keep them because they document the required behavior.

- [ ] **Step 3: Normalize validation errors on upload detail routes**

In `apps/api/src/modules/uploads/index.ts`, add the same validation handler used by `uploadsModule` to `uploadDetailsModule`:

```ts
return new Elysia({ name: "upload-details", prefix: "/_api/uploads/:uploadTaskId" })
  .model(uploadModels)
  .onError(({ code, status }) => {
    if (code === "VALIDATION") {
      return status(400, { code: "VALIDATION_ERROR" as const });
    }
  })
```

Do not change stable status mapping unless a test proves it is wrong.

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
bun test tests/unit/uploads-routes.test.ts
bun run --filter @zipship/api typecheck
```

Expected: all commands exit with code 0.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/uploads/index.ts apps/api/src/modules/uploads/service.ts tests/unit/uploads-routes.test.ts
git commit -m "test: harden raw upload route coverage"
```

---

### Task 4: Strengthen Failed Detection Assertions

**Files:**
- Modify: `tests/unit/uploads-routes.test.ts`

**Interfaces:**
- Consumes:
  - `@zipship/deploy-core` detection result shape.
- Produces:
  - A failed release test that proves `.env` detection is the reason for failure.

- [ ] **Step 1: Write stronger assertion for detect failure details**

In the existing `marks release failed when deploy-core detection fails` test, replace the final detect assertion:

```ts
expect((firstRelease?.detectResult as { level: string }).level).toBe("failed");
```

with:

```ts
expect(firstRelease).toBeDefined();
if (!firstRelease) throw new Error("Expected failed release to be listed");
expect(firstRelease.status).toBe("failed");

const detectResult = firstRelease.detectResult as {
  level: string;
  items: Array<{ level: string; code: string; details?: Record<string, unknown> }>;
};
expect(detectResult.level).toBe("failed");
expect(detectResult.items.some((item) => item.code === "ENV_FILE_DETECTED")).toBe(true);
expect(firstRelease.fileCount).toBe(0);
expect(firstRelease.totalSize).toBe(completedData?.size);
```

- [ ] **Step 2: Run test to verify behavior**

Run:

```bash
bun test tests/unit/uploads-routes.test.ts --test-name-pattern "marks release failed"
```

Expected: PASS if the implementation already persists the deploy-core detection payload. If it fails because the code is different, inspect `packages/deploy-core/src/detect.ts` and assert the exact stable code currently emitted for `.env` files.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/uploads-routes.test.ts
git commit -m "test: assert failed release detection details"
```

---

### Task 5: Update Documentation To Match Proven Behavior

**Files:**
- Modify: `docs/02-技术架构.md`
- Modify: `docs/03-测试规范与实施路线.md`

**Interfaces:**
- Consumes:
  - Behavior proven by Tasks 1-4.
- Produces:
  - Chinese documentation that accurately states what is implemented and what remains.

- [ ] **Step 1: Update architecture document**

In `docs/02-技术架构.md`, replace the current upload-processing paragraph with text that matches the corrected flow:

```md
当前实现：`PUT /_api/uploads/:uploadTaskId/raw` 接收 zip 文件并保存到 `storageRoot/uploads/raw/{projectId}/{uploadTaskId}/`。`POST /_api/uploads/:uploadTaskId/complete` 会先确认 raw 文件仍然存在，再把 upload_task 推进到 `processing`，并同步调用 `@zipship/deploy-core` 的 `processRelease()` 执行解压、安全检测、产物检测和 manifest 生成。检测通过时，后端会把解析出的 artifact root 复制到 `storageRoot/sites/{projectId}/releases/{releaseHash}`，然后将 release 推进到 `ready`、upload_task 推进到 `completed`；检测失败时，release 和 upload_task 都推进到 `failed`，并保留稳定错误码与 detectResult，供控制台展示。
```

Keep the “需要额外处理” list, but make sure it still includes:

```txt
上传中断
重复上传策略
hash 冲突
同项目并发上传
用户取消上传
处理任务失败后重试
temp 目录清理
测试地址生成与静态服务路由
```

- [ ] **Step 2: Update testing roadmap document**

In `docs/03-测试规范与实施路线.md`, keep completed items checked only when the tests prove them. Phase 3 should read:

````md
### Phase 3：项目与上传

```txt
✓ 创建项目
✓ 组织项目列表
✓ 项目详情
✓ slug 校验
✓ 创建 pending upload_task
✓ 上传任务详情
✓ 上传任务 complete 状态流转
✓ complete 后关联 release
✓ 项目 release 列表
✓ 上传 zip 到本地 storage
✓ 同步 deploy-core 解压检测
✓ 生成真实 release_hash / manifest / detectResult
✓ release ready / failed 状态流转
✓ ready release artifact 持久化到 storageRoot/sites
返回测试地址
```
````

Do not mark `返回测试地址` as complete unless this task also implements static route generation and serving, which this plan explicitly does not include.

Add a short note near the API testing section:

```md
上传处理相关测试必须测试先行：先用 Eden Treaty 或直接 `app.handle()` 写出失败测试并确认失败，再修改实现。重点覆盖 raw 文件真实落盘、ready release 的 artifact 真实存在、失败检测细节、重复 complete / 重复 raw upload 的状态错误码。
```

- [ ] **Step 3: Verify docs contain no misleading completion claim**

Run:

```bash
rg -n "Phase 3|返回测试地址|ready release artifact|测试先行|移动到 /sites" docs/02-技术架构.md docs/03-测试规范与实施路线.md
```

Expected:
- `返回测试地址` is still present as remaining work, not checked.
- `ready release artifact 持久化到 storageRoot/sites` is checked.
- The old claim “移动到 /sites/:slug/releases/:hash” is either replaced or clearly described as the intended serving location, not an already complete behavior using `slug`.

- [ ] **Step 4: Commit**

```bash
git add docs/02-技术架构.md docs/03-测试规范与实施路线.md
git commit -m "docs: clarify upload processing hardening"
```

---

### Task 6: Full Verification And CodeGraph Sync

**Files:**
- No production edits expected.
- May update `.codegraph/` index locally, but do not commit `.codegraph/`.

**Interfaces:**
- Consumes:
  - All previous task changes.
- Produces:
  - A verified branch ready for review.

- [ ] **Step 1: Run full verification**

Run:

```bash
bun test
bun test --coverage
bun run typecheck
bun run db:generate
bun --filter @zipship/desktop-shell lint
bun --filter @zipship/desktop-shell package
```

Expected:
- All tests pass.
- Typecheck exits with code 0.
- `db:generate` reports no unexpected migration drift.
- Desktop lint/package pass. The existing `inlineDynamicImports` warning may still appear; do not fix it in this plan unless a test or package command fails.

- [ ] **Step 2: Check for untracked generated files**

Run:

```bash
git status --short
git ls-files --others --exclude-standard
find . -name '.DS_Store' -o -name '.env.local' -o -name '.tmp-*' | sort
```

Expected:
- `git status --short` is clean after commits.
- No untracked generated files need to be committed.
- No `.DS_Store`, `.env.local`, or `.tmp-*` files remain in the repo.

- [ ] **Step 3: Sync CodeGraph**

Run:

```bash
codegraph sync .
```

Expected: CodeGraph completes successfully. Do not commit `.codegraph/`.

- [ ] **Step 4: Prepare review summary**

Write a short Chinese summary for the reviewer with:

```txt
本轮修复：
- ready release 现在会把 artifact 持久化到 storageRoot/sites/{projectId}/releases/{releaseHash}
- complete 对 pending / uploading 丢文件 / completed 的错误码区分已由测试覆盖
- raw upload 的鉴权、not found、真实落盘、完成后重传、validation 已覆盖
- failed detection 会断言具体检测 code
- 文档已改为只标注已证明完成的能力

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

- [ ] Every task began with a failing or strengthening test before production code changed.
- [ ] `ready` release status is not written unless final artifact files exist in release storage.
- [ ] `complete` no longer returns `RAW_UPLOAD_REQUIRED` for already completed tasks.
- [ ] Missing raw files do not leave upload tasks stuck in `processing`.
- [ ] Raw upload route has tests for authorization, not found, persisted bytes, completed-state rejection, and malformed body validation.
- [ ] Failed detection tests assert the concrete deploy-core detection code, not only `level: failed`.
- [ ] Chinese docs do not claim “返回测试地址” is complete.
- [ ] Full verification passes and the git worktree is clean.
