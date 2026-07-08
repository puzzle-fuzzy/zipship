import { treaty } from "@elysia/eden";
import { beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createApp } from "../../apps/api/src/index";
import { createTestDbClient } from "../../apps/api/src/db/client";
import { truncateAllTables } from "../../apps/api/src/db/test-utils";

const db = createTestDbClient(
  process.env.TEST_DATABASE_URL ?? "postgres://zipship:zipship@localhost:5432/zipship"
);

beforeEach(async () => {
  await truncateAllTables(db);
});

function createTempStorageRoot() {
  return mkdtempSync(join(tmpdir(), "zipship-api-release-"));
}

async function registerLoginAndCreateProject(api = treaty(createApp({ db }))) {
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
  const storageRoot = createTempStorageRoot();
  const api = treaty(createApp({ storageRoot, db }));
  const context = await registerLoginAndCreateProject(api);
  const created = await api._api.projects({ projectId: context.project.id }).uploads.post(
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
    rmSync(storageRoot, { recursive: true, force: true });
    throw new Error("Upload task creation unexpectedly returned no task");
  }

  const bytes = await Bun.file(join(import.meta.dir, "../../packages/deploy-core/tests/fixtures/valid-vite-relative-base.zip")).arrayBuffer();
  await api._api.uploads({ uploadTaskId: uploadTask.id }).raw.put(
    { file: new File([bytes], "dist.zip", { type: "application/zip" }) },
    { headers: { authorization: `Bearer ${context.refreshToken}` } },
  );

  const completed = await api._api.uploads({ uploadTaskId: uploadTask.id }).complete.post(null, {
    headers: {
      authorization: `Bearer ${context.refreshToken}`,
    },
  });
  const completedTask = completed.data?.uploadTask;

  if (!completedTask?.releaseId) {
    rmSync(storageRoot, { recursive: true, force: true });
    throw new Error("Upload task completion unexpectedly returned no release id");
  }

  return {
    api,
    storageRoot,
    refreshToken: context.refreshToken,
    project: context.project,
    uploadTask: completedTask,
  };
}

describe("releases routes", () => {
  test("lists project releases created by completed upload tasks", async () => {
    const { api, storageRoot, refreshToken, project, uploadTask } = await createCompletedUpload();
    try {
      const response = await api._api.projects({ projectId: project.id }).releases.get({
        headers: {
          authorization: `Bearer ${refreshToken}`,
        },
      });

      expect(response.status).toBe(200);
      expect(response.data?.releases).toHaveLength(1);
      const release = response.data?.releases[0];

      expect(release).toBeDefined();
      if (!release) throw new Error("Expected release list to contain the completed upload");

      expect(release.releaseHash).toEqual(expect.any(String));
      expect(release.releaseHash).toHaveLength(12);
      expect(release.fullHash).toEqual(expect.any(String));
      expect(release.fullHash).toHaveLength(64);
      expect(release.status).toBe("ready");
      expect(release.previewUrl).toBe(`/_sites/${project.slug}/${release.releaseHash}/`);
      expect(release.storagePath).toContain(storageRoot);
      expect(release.storagePath).toContain(project.slug);
      expect(release.storagePath).not.toContain(project.id);
      expect(existsSync(release.storagePath)).toBe(true);
      expect(existsSync(join(release.storagePath, "index.html"))).toBe(true);
      expect(release.fileCount).toBeGreaterThan(0);
      expect(release.totalSize).toBeGreaterThan(0);
      expect((release.detectResult as { level: string }).level).toBe("pass");
      expect(release.createdAt).toBeDefined();
      expect(release.id).toBe(uploadTask.releaseId!);
      expect(release.projectId).toBe(project.id);
      expect(release.versionNumber).toBe(1);
      expect(release.rawUploadPath).toBe(uploadTask.rawUploadPath);
      expect(release.createdBy).toBe(project.createdBy);
      expect(release.activatedAt).toBeNull();
      expect(release.archivedAt).toBeNull();

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
    } finally {
      rmSync(storageRoot, { recursive: true, force: true });
    }
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
    const api = treaty(createApp({ db }));

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

  test("returns previewUrl for active releases", async () => {
    const { api, storageRoot, refreshToken, project, uploadTask } = await createCompletedUpload();
    try {
      const releasesBeforePublish = await api._api.projects({ projectId: project.id }).releases.get({
        headers: { authorization: `Bearer ${refreshToken}` },
      });
      const release = releasesBeforePublish.data?.releases[0];
      if (!release) throw new Error("Expected ready release before publish");

      await api._api.projects({ projectId: project.id }).releases({ releaseId: release.id }).publish.post(
        { message: "Ship v1" },
        { headers: { authorization: `Bearer ${refreshToken}` } },
      );

      const releasesAfterPublish = await api._api.projects({ projectId: project.id }).releases.get({
        headers: { authorization: `Bearer ${refreshToken}` },
      });
      const activeRelease = releasesAfterPublish.data?.releases.find((candidate) => candidate.id === uploadTask.releaseId);
      expect(activeRelease?.status).toBe("active");
      expect(activeRelease?.previewUrl).toBe(`/_sites/${project.slug}/${release.releaseHash}/`);
    } finally {
      rmSync(storageRoot, { recursive: true, force: true });
    }
  });
});
