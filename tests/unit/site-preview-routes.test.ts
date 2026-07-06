import { treaty } from "@elysia/eden";
import { beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
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
  return mkdtempSync(join(tmpdir(), "zipship-api-site-preview-"));
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

async function createReadyRelease(storageRoot: string) {
  const app = createApp({ storageRoot, db });
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

async function createFailedRelease(storageRoot: string) {
  const app = createApp({ storageRoot, db });
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

  test("serves an active release preview after publish", async () => {
    const storageRoot = createTempStorageRoot();
    try {
      const app = createApp({ storageRoot, db, exposeTestRoutes: true });
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
      if (!release) throw new Error("Expected release listing to contain release");

      await api._api.projects({ projectId: project.id }).releases({ releaseId: release.id }).publish.post(
        { message: "Ship v1" },
        { headers: { authorization: `Bearer ${refreshToken}` } },
      );

      const response = await app.handle(new Request(`http://localhost/_sites/${project.slug}/${release.releaseHash}/`));
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/html");
      expect(await response.text()).toContain("./assets/index.js");
    } finally {
      rmSync(storageRoot, { recursive: true, force: true });
    }
  });
});
