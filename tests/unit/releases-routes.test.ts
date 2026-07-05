import { treaty } from "@elysia/eden";
import { describe, expect, test } from "bun:test";
import { createApp } from "../../apps/api/src/index";

async function registerLoginAndCreateProject() {
  const api = treaty(createApp());

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

async function createCompletedUpload() {
  const context = await registerLoginAndCreateProject();
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

  const completed = await context.api._api.uploads({ uploadTaskId: uploadTask.id }).complete.post(null, {
    headers: {
      authorization: `Bearer ${context.refreshToken}`,
    },
  });
  const completedTask = completed.data?.uploadTask;

  if (!completedTask?.releaseId) {
    throw new Error("Upload task completion unexpectedly returned no release id");
  }

  return {
    ...context,
    uploadTask: completedTask,
  };
}

describe("releases routes", () => {
  test("lists project releases created by completed upload tasks", async () => {
    const { api, refreshToken, project, uploadTask } = await createCompletedUpload();

    const response = await api._api.projects({ projectId: project.id }).releases.get({
      headers: {
        authorization: `Bearer ${refreshToken}`,
      },
    });

    expect(response.status).toBe(200);
    expect(response.data?.releases).toHaveLength(1);
    const release = response.data?.releases[0];

    expect(release?.releaseHash).toEqual(expect.any(String));
    expect(release?.releaseHash).toHaveLength(32);
    expect(release?.createdAt).toBeDefined();
    expect(release).toMatchObject({
      id: uploadTask.releaseId,
      projectId: project.id,
      versionNumber: 1,
      fullHash: `pending:${uploadTask.id}`,
      status: "processing",
      storagePath: expect.stringContaining(project.id),
      rawUploadPath: uploadTask.rawUploadPath,
      fileCount: 0,
      totalSize: 1024,
      manifest: {},
      detectResult: {},
      createdBy: project.createdBy,
      activatedAt: null,
      archivedAt: null,
    });
  });

  test("returns an empty list before a project has releases", async () => {
    const { api, refreshToken, project } = await registerLoginAndCreateProject();

    const response = await api._api.projects({ projectId: project.id }).releases.get({
      headers: {
        authorization: `Bearer ${refreshToken}`,
      },
    });

    expect(response.status).toBe(200);
    expect(response.data).toEqual({
      releases: [],
    });
  });

  test("returns unauthorized without a bearer token", async () => {
    const api = treaty(createApp());

    const response = await api._api.projects({ projectId: "project-1" }).releases.get();

    expect(response.status).toBe(401);
    expect((response.error?.value as unknown)).toEqual({
      code: "UNAUTHORIZED",
    });
  });

  test("returns not found for an unknown project id", async () => {
    const { api, refreshToken } = await registerLoginAndCreateProject();

    const response = await api._api.projects({ projectId: "missing-project" }).releases.get({
      headers: {
        authorization: `Bearer ${refreshToken}`,
      },
    });

    expect(response.status).toBe(404);
    expect((response.error?.value as unknown)).toEqual({
      code: "PROJECT_NOT_FOUND",
    });
  });
});
