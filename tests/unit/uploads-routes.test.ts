import { treaty } from "@elysia/eden";
import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createApp } from "../../apps/api/src/index";

function createTempStorageRoot() {
  return mkdtempSync(join(tmpdir(), "zipship-api-upload-"));
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

async function registerLoginCreateProjectAndUploadTask(api = treaty(createApp())) {
  const context = await registerLoginAndCreateProject(api);
  const created = await context.api._api.projects({ projectId: context.project.id }).uploads.post(
    {
      originalFilename: "dist.zip",
      size: 1024,
    },
    {
      headers: {
        authorization: `Bearer ${context.refreshToken}`,
      },
    },
  );
  const uploadTask = created.data?.uploadTask;

  if (!uploadTask) {
    throw new Error("Upload task creation unexpectedly returned no task");
  }

  return {
    ...context,
    uploadTask,
  };
}

describe("uploads routes", () => {
  test("completes an upload task after raw upload and marks the upload as completed", async () => {
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

      const response = await api._api.uploads({ uploadTaskId: uploadTask.id }).complete.post(null, {
        headers: { authorization: `Bearer ${refreshToken}` },
      });

      expect(response.status).toBe(200);
      expect(response.data?.uploadTask).toMatchObject({
        id: uploadTask.id,
        projectId: uploadTask.projectId,
        releaseId: expect.any(String),
        status: "completed",
        errorMessage: null,
        createdBy: uploadTask.createdBy,
      });
    } finally {
      rmSync(storageRoot, { recursive: true, force: true });
    }
  });

  test("returns an upload task detail by id", async () => {
    const { api, refreshToken, uploadTask } = await registerLoginCreateProjectAndUploadTask();

    const response = await api._api.uploads({ uploadTaskId: uploadTask.id }).get({
      headers: {
        authorization: `Bearer ${refreshToken}`,
      },
    });

    expect(response.status).toBe(200);
    expect(response.data).toEqual({
      uploadTask,
    });
  });

  test("creates a pending upload task for a project", async () => {
    const { api, refreshToken, project } = await registerLoginAndCreateProject();

    const response = await api._api.projects({ projectId: project.id }).uploads.post(
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

    expect(response.status).toBe(201);
    expect(response.data).toMatchObject({
      uploadTask: {
        id: expect.any(String),
        projectId: project.id,
        releaseId: null,
        status: "pending",
        rawUploadPath: expect.stringContaining(project.id),
        originalFilename: "dist.zip",
        size: 1024,
        errorMessage: null,
        createdBy: project.createdBy,
        startedAt: null,
        finishedAt: null,
      },
    });
  });

  test("returns unauthorized without a bearer token", async () => {
    const api = treaty(createApp());

    const response = await api._api.projects({ projectId: "project-1" }).uploads.post({
      originalFilename: "dist.zip",
      size: 1024,
    });

    expect(response.status).toBe(401);
    expect((response.error?.value as unknown)).toEqual({
      code: "UNAUTHORIZED",
    });
  });

  test("returns unauthorized for upload task detail without a bearer token", async () => {
    const api = treaty(createApp());

    const response = await api._api.uploads({ uploadTaskId: "upload-task-1" }).get();

    expect(response.status).toBe(401);
    expect((response.error?.value as unknown)).toEqual({
      code: "UNAUTHORIZED",
    });
  });

  test("returns unauthorized when completing an upload task without a bearer token", async () => {
    const api = treaty(createApp());

    const response = await api._api.uploads({ uploadTaskId: "upload-task-1" }).complete.post(null);

    expect(response.status).toBe(401);
    expect((response.error?.value as unknown)).toEqual({
      code: "UNAUTHORIZED",
    });
  });

  test("returns not found for an unknown upload task id", async () => {
    const { api, refreshToken } = await registerLoginAndCreateProject();

    const response = await api._api.uploads({ uploadTaskId: "missing-upload-task" }).get({
      headers: {
        authorization: `Bearer ${refreshToken}`,
      },
    });

    expect(response.status).toBe(404);
    expect((response.error?.value as unknown)).toEqual({
      code: "UPLOAD_TASK_NOT_FOUND",
    });
  });

  test("returns not found when completing an unknown upload task id", async () => {
    const { api, refreshToken } = await registerLoginAndCreateProject();

    const response = await api._api.uploads({ uploadTaskId: "missing-upload-task" }).complete.post(null, {
      headers: {
        authorization: `Bearer ${refreshToken}`,
      },
    });

    expect(response.status).toBe(404);
    expect((response.error?.value as unknown)).toEqual({
      code: "UPLOAD_TASK_NOT_FOUND",
    });
  });

  test("rejects completing an upload task that is already completed", async () => {
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

      const response = await api._api.uploads({ uploadTaskId: uploadTask.id }).complete.post(null, {
        headers: { authorization: `Bearer ${refreshToken}` },
      });

      expect(response.status).toBe(409);
      expect((response.error?.value as unknown)).toEqual({
        code: "UPLOAD_TASK_NOT_UPLOADING",
      });
    } finally {
      rmSync(storageRoot, { recursive: true, force: true });
    }
  });

  test("returns not found for an unknown project id", async () => {
    const { api, refreshToken } = await registerLoginAndCreateProject();

    const response = await api._api.projects({ projectId: "missing-project" }).uploads.post(
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

    expect(response.status).toBe(404);
    expect((response.error?.value as unknown)).toEqual({
      code: "PROJECT_NOT_FOUND",
    });
  });

  test("rejects non-zip upload task filenames", async () => {
    const { api, refreshToken, project } = await registerLoginAndCreateProject();

    const response = await api._api.projects({ projectId: project.id }).uploads.post(
      {
        originalFilename: "dist.tar.gz",
        size: 1024,
      },
      {
        headers: {
          authorization: `Bearer ${refreshToken}`,
        },
      },
    );

    expect(response.status).toBe(400);
    expect((response.error?.value as unknown)).toEqual({
      code: "INVALID_UPLOAD_INPUT",
    });
  });

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

  test("completes an uploaded zip and marks its release ready", async () => {
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

      const completed = await api._api.uploads({ uploadTaskId: uploadTask.id }).complete.post(null, {
        headers: { authorization: `Bearer ${refreshToken}` },
      });

      expect(completed.status).toBe(200);
      expect(completed.data?.uploadTask).toMatchObject({
        id: uploadTask.id,
        status: "completed",
        errorMessage: null,
      });

      const releases = await api._api.projects({ projectId: project.id }).releases.get({
        headers: { authorization: `Bearer ${refreshToken}` },
      });

      const firstRelease = releases.data?.releases[0];
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
    } finally {
      rmSync(storageRoot, { recursive: true, force: true });
    }
  });

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

  test("rejects completing before raw zip upload exists", async () => {
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

      const response = await api._api.uploads({ uploadTaskId: uploadTask.id }).complete.post(null, {
        headers: { authorization: `Bearer ${refreshToken}` },
      });

      expect(response.status).toBe(409);
      expect((response.error?.value as unknown)).toEqual({ code: "RAW_UPLOAD_REQUIRED" });
    } finally {
      rmSync(storageRoot, { recursive: true, force: true });
    }
  });

  test("marks release failed when deploy-core detection fails", async () => {
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

      const bytes = await Bun.file(join(import.meta.dir, "../../packages/deploy-core/tests/fixtures/dot-env.zip")).arrayBuffer();
      await api._api.uploads({ uploadTaskId: uploadTask.id }).raw.put(
        { file: new File([bytes], "dist.zip", { type: "application/zip" }) },
        { headers: { authorization: `Bearer ${refreshToken}` } },
      );

      const completed = await api._api.uploads({ uploadTaskId: uploadTask.id }).complete.post(null, {
        headers: { authorization: `Bearer ${refreshToken}` },
      });

      expect(completed.status).toBe(200);
      const completedData = completed.data?.uploadTask;
      expect(completedData?.status).toBe("failed");

      // The error message should indicate detection failure
      expect(completedData?.errorMessage).toBe("DETECT_FAILED");

      const releases = await api._api.projects({ projectId: project.id }).releases.get({
        headers: { authorization: `Bearer ${refreshToken}` },
      });

      const firstRelease = releases.data?.releases[0];
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
      // totalSize is the original zip size when detection fails
      // (deploy-core doesn't process files for failed detections)
    } finally {
      rmSync(storageRoot, { recursive: true, force: true });
    }
  });

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
});
