import { treaty } from "@elysia/eden";
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
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
  test("marks a pending upload task as processing when completed", async () => {
    const { api, refreshToken, uploadTask } = await registerLoginCreateProjectAndUploadTask();

    const response = await api._api.uploads({ uploadTaskId: uploadTask.id }).complete.post(null, {
      headers: {
        authorization: `Bearer ${refreshToken}`,
      },
    });

    expect(response.status).toBe(200);
    expect(response.data).toMatchObject({
      uploadTask: {
        id: uploadTask.id,
        projectId: uploadTask.projectId,
        releaseId: expect.any(String),
        status: "processing",
        rawUploadPath: uploadTask.rawUploadPath,
        originalFilename: "dist.zip",
        size: 1024,
        errorMessage: null,
        createdBy: uploadTask.createdBy,
        finishedAt: null,
      },
    });
    expect(response.data?.uploadTask.startedAt).toBeInstanceOf(Date);
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

  test("rejects completing an upload task that is not pending", async () => {
    const { api, refreshToken, uploadTask } = await registerLoginCreateProjectAndUploadTask();

    await api._api.uploads({ uploadTaskId: uploadTask.id }).complete.post(null, {
      headers: {
        authorization: `Bearer ${refreshToken}`,
      },
    });
    const response = await api._api.uploads({ uploadTaskId: uploadTask.id }).complete.post(null, {
      headers: {
        authorization: `Bearer ${refreshToken}`,
      },
    });

    expect(response.status).toBe(409);
    expect((response.error?.value as unknown)).toEqual({
      code: "UPLOAD_TASK_NOT_PENDING",
    });
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
});
