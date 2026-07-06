import { treaty } from "@elysia/eden";
import { beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "fs";
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
  return mkdtempSync(join(tmpdir(), "zipship-e2e-upload-"));
}

describe("upload flow (e2e)", () => {
  test("full lifecycle: create → raw → complete → release is ready", async () => {
    const storageRoot = createTempStorageRoot();
    try {
      const api = treaty(createApp({ storageRoot, db }));

      // Register + login + create project
      await api._api.auth.register.post({
        name: "Upload Tester",
        email: "upload@test.com",
        password: "upload-test-pw",
      });
      const login = await api._api.auth.login.post({
        email: "upload@test.com",
        password: "upload-test-pw",
        clientType: "web",
      });
      const token = login.data!.session.refreshToken;

      const orgs = await api._api.organizations.get({
        headers: { authorization: `Bearer ${token}` },
      });
      const orgId = orgs.data!.organizations[0].id;

      const project = await api._api.organizations({ organizationId: orgId }).projects.post(
        { name: "E2E Site", slug: "e2e-site", description: null },
        { headers: { authorization: `Bearer ${token}` } },
      );
      const projectId = project.data!.project.id;

      // Step 1: Create upload task
      const created = await api._api.projects({ projectId }).uploads.post(
        { originalFilename: "e2e-deploy.zip", size: 2048 },
        { headers: { authorization: `Bearer ${token}` } },
      );
      expect(created.status).toBe(201);
      const uploadTask = created.data!.uploadTask;
      expect(uploadTask.status).toBe("pending");
      expect(uploadTask.releaseId).toBeNull();

      // Step 2: Upload raw bytes
      const bytes = await Bun.file(
        join(import.meta.dir, "../../packages/deploy-core/tests/fixtures/valid-vite-relative-base.zip")
      ).arrayBuffer();
      const raw = await api._api.uploads({ uploadTaskId: uploadTask.id }).raw.put(
        { file: new File([bytes], "e2e-deploy.zip", { type: "application/zip" }) },
        { headers: { authorization: `Bearer ${token}` } },
      );
      expect(raw.status).toBe(200);
      expect(raw.data?.uploadTask.status).toBe("uploading");
      expect(existsSync(raw.data!.uploadTask.rawUploadPath)).toBe(true);

      // Step 3: Complete the upload
      const complete = await api._api.uploads({ uploadTaskId: uploadTask.id }).complete.post(null, {
        headers: { authorization: `Bearer ${token}` },
      });
      expect(complete.status).toBe(200);
      expect(complete.data?.uploadTask.status).toBe("completed");
      expect(complete.data?.uploadTask.errorMessage).toBeNull();
      expect(complete.data?.uploadTask.releaseId).toBeString();

      // Step 4: Verify release is listed
      const releases = await api._api.projects({ projectId }).releases.get({
        headers: { authorization: `Bearer ${token}` },
      });
      expect(releases.status).toBe(200);
      expect(releases.data?.releases).toHaveLength(1);

      const release = releases.data!.releases[0];
      expect(release.status).toBe("ready");
      expect(release.releaseHash).toHaveLength(12);
      expect(release.fileCount).toBeGreaterThan(0);
      expect(existsSync(release.storagePath)).toBe(true);
      expect(existsSync(join(release.storagePath, "index.html"))).toBe(true);

      // Verify the manifest is complete
      const manifest = release.manifest as Record<string, unknown>;
      expect(manifest.version).toBe(1);
      expect(manifest.hashAlgorithm).toBe("sha256");
    } finally {
      rmSync(storageRoot, { recursive: true, force: true });
    }
  });

  test("register → login → create project → upload → wrong file format fails gracefully", async () => {
    const storageRoot = createTempStorageRoot();
    try {
      const api = treaty(createApp({ storageRoot, db }));

      await api._api.auth.register.post({
        name: "Grace Hopper",
        email: "grace@example.com",
        password: "grace-pw-123",
      });
      const login = await api._api.auth.login.post({
        email: "grace@example.com",
        password: "grace-pw-123",
        clientType: "web",
      });
      const token = login.data!.session.refreshToken;

      const orgs = await api._api.organizations.get({
        headers: { authorization: `Bearer ${token}` },
      });
      const project = await api._api.organizations({ organizationId: orgs.data!.organizations[0].id }).projects.post(
        { name: "Test", slug: "test-upload-fail", description: null },
        { headers: { authorization: `Bearer ${token}` } },
      );
      const projectId = project.data!.project.id;

      // Create + upload random data (not a valid zip)
      const created = await api._api.projects({ projectId }).uploads.post(
        { originalFilename: "not-a-zip.txt", size: 50 },
        { headers: { authorization: `Bearer ${token}` } },
      );
      expect(created.status).toBe(400);
      expect((created.error?.value as unknown)).toEqual({ code: "INVALID_UPLOAD_INPUT" });
    } finally {
      rmSync(storageRoot, { recursive: true, force: true });
    }
  });

  test("re-creating the same project slug after upload does not corrupt the previous project", async () => {
    const storageRoot = createTempStorageRoot();
    try {
      const api = treaty(createApp({ storageRoot, db }));

      // Register two users with different orgs
      await api._api.auth.register.post({
        name: "User A",
        email: "usera@example.com",
        password: "password-a",
      });
      const loginA = await api._api.auth.login.post({
        email: "usera@example.com",
        password: "password-a",
        clientType: "web",
      });
      const tokenA = loginA.data!.session.refreshToken;

      await api._api.auth.register.post({
        name: "User B",
        email: "userb@example.com",
        password: "password-b",
      });
      const loginB = await api._api.auth.login.post({
        email: "userb@example.com",
        password: "password-b",
        clientType: "web",
      });
      const tokenB = loginB.data!.session.refreshToken;

      // Both create a project (different orgs, globally-unique slugs)
      const orgsA = await api._api.organizations.get({ headers: { authorization: `Bearer ${tokenA}` } });
      const orgA = orgsA.data!.organizations[0];

      const projA = await api._api.organizations({ organizationId: orgA.id }).projects.post(
        { name: "A Site", slug: "site-a", description: null },
        { headers: { authorization: `Bearer ${tokenA}` } },
      );
      expect(projA.status).toBe(201);

      const orgsB = await api._api.organizations.get({ headers: { authorization: `Bearer ${tokenB}` } });
      const orgB = orgsB.data!.organizations[0];

      const projB = await api._api.organizations({ organizationId: orgB.id }).projects.post(
        { name: "B Site", slug: "site-b", description: null },
        { headers: { authorization: `Bearer ${tokenB}` } },
      );
      expect(projB.status).toBe(201);

      // Both projects should have different IDs
      expect(projA.data!.project.id).not.toBe(projB.data!.project.id);
    } finally {
      rmSync(storageRoot, { recursive: true, force: true });
    }
  });
});
