import { treaty } from "@elysia/eden";
import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readlinkSync, rmSync } from "fs";
import { mkdir } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { createApp } from "../../apps/api/src/index";
import { readLinkTarget } from "../helpers/path";

type TestAuditLog = {
  projectId: string | null;
  actorId: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  metadata: Record<string, unknown>;
};

function createTempStorageRoot() {
  return mkdtempSync(join(tmpdir(), "zipship-api-deployments-"));
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
    headers: { authorization: `Bearer ${refreshToken}` },
  });
  const organizationId = organizations.data?.organizations[0]?.id ?? "";
  const created = await api._api.organizations({ organizationId }).projects.post(
    {
      name: "Marketing Site",
      slug: `marketing-site-${crypto.randomUUID().slice(0, 8)}`,
      description: "Launch pages",
    },
    {
      headers: { authorization: `Bearer ${refreshToken}` },
    },
  );
  const project = created.data?.project;
  if (!project) throw new Error("Project creation unexpectedly returned no project");

  return { api, refreshToken, project };
}

async function createReadyRelease(api: ReturnType<typeof treaty>, projectId: string, refreshToken: string) {
  const created = await api._api.projects({ projectId }).uploads.post(
    { originalFilename: "dist.zip", size: 1024 },
    { headers: { authorization: `Bearer ${refreshToken}` } },
  );
  const uploadTask = created.data?.uploadTask;
  if (!uploadTask) throw new Error("Upload task creation unexpectedly returned no task");

  const bytes = await Bun.file(
    join(import.meta.dir, "../../packages/deploy-core/tests/fixtures/valid-vite-relative-base.zip"),
  ).arrayBuffer();
  await api._api.uploads({ uploadTaskId: uploadTask.id }).raw.put(
    { file: new File([bytes], "dist.zip", { type: "application/zip" }) },
    { headers: { authorization: `Bearer ${refreshToken}` } },
  );
  await api._api.uploads({ uploadTaskId: uploadTask.id }).complete.post(null, {
    headers: { authorization: `Bearer ${refreshToken}` },
  });

  const releases = await api._api.projects({ projectId }).releases.get({
    headers: { authorization: `Bearer ${refreshToken}` },
  });
  const release = releases.data?.releases[0];
  if (!release) throw new Error("Release listing unexpectedly returned no release");

  return release;
}

async function listAuditLogs(app: ReturnType<typeof createApp>): Promise<TestAuditLog[]> {
  const response = await app.handle(new Request("http://localhost/_api/__test/auditLogs"));
  expect(response.status).toBe(200);

  const body = (await response.json()) as { auditLogs: TestAuditLog[] };
  return body.auditLogs;
}

describe("deployments routes", () => {
  test("publishes a ready release and records deployment and audit", async () => {
    const storageRoot = createTempStorageRoot();
    try {
      const app = createApp({ storageRoot, exposeTestRoutes: true });
      const api = treaty(app);
      const { refreshToken, project } = await registerLoginAndCreateProject(api);
      const release = await createReadyRelease(api, project.id, refreshToken);

      const response = await api._api.projects({ projectId: project.id }).releases({ releaseId: release.id }).publish.post(
        { message: "Ship v1" },
        { headers: { authorization: `Bearer ${refreshToken}` } },
      );

      expect(response.status).toBe(200);
      expect(response.data?.deployment).toMatchObject({
        projectId: project.id,
        releaseId: release.id,
        previousReleaseId: null,
        action: "publish",
        status: "success",
        message: "Ship v1",
        operatorId: project.createdBy,
      });
      expect(response.data?.project).toMatchObject({
        id: project.id,
        currentReleaseId: release.id,
      });
      expect(response.data?.release).toMatchObject({
        id: release.id,
        status: "active",
        previewUrl: `/_sites/${project.slug}/${release.releaseHash}/`,
      });
      expect(response.data?.release.activatedAt).toBeTruthy();
      expect(Number.isNaN(new Date(response.data?.release.activatedAt ?? "").getTime())).toBe(false);
      expect(response.data?.previousRelease).toBeNull();

      const deployments = await api._api.projects({ projectId: project.id }).deployments.get({
        headers: { authorization: `Bearer ${refreshToken}` },
      });
      expect(deployments.status).toBe(200);
      expect(deployments.data?.deployments).toHaveLength(1);
      expect(deployments.data?.deployments[0]).toMatchObject({
        releaseId: release.id,
        action: "publish",
        status: "success",
      });

      const auditLogs = await listAuditLogs(app);
      expect(auditLogs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            projectId: project.id,
            actorId: project.createdBy,
            action: "release.published",
            targetType: "release",
            targetId: release.id,
            metadata: expect.objectContaining({
              releaseId: release.id,
              previousReleaseId: null,
              message: "Ship v1",
            }),
          }),
        ]),
      );

      const currentPath = join(storageRoot, "sites", project.slug, "current");
      expect(existsSync(currentPath)).toBe(true);
      expect(readLinkTarget(currentPath)).toBe(`releases/${release.releaseHash}`);
    } finally {
      rmSync(storageRoot, { recursive: true, force: true });
    }
  });

  test("rejects publish without a bearer token", async () => {
    const storageRoot = createTempStorageRoot();
    try {
      const api = treaty(createApp({ storageRoot, exposeTestRoutes: true }));
      const { refreshToken, project } = await registerLoginAndCreateProject(api);
      const release = await createReadyRelease(api, project.id, refreshToken);

      const response = await api._api.projects({ projectId: project.id }).releases({ releaseId: release.id }).publish.post({
        message: null,
      });

      expect(response.status).toBe(401);
      expect((response.error?.value as unknown)).toEqual({ code: "UNAUTHORIZED" });
    } finally {
      rmSync(storageRoot, { recursive: true, force: true });
    }
  });

  test("rejects publish for developer and viewer roles", async () => {
    const storageRoot = createTempStorageRoot();
    try {
      const app = createApp({ storageRoot, exposeTestRoutes: true });
      const api = treaty(app);
      const { refreshToken, project } = await registerLoginAndCreateProject(api);
      const release = await createReadyRelease(api, project.id, refreshToken);

      await app.handle(
        new Request("http://localhost/_api/__test/memberRole", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ userId: project.createdBy, organizationId: project.organizationId, role: "developer" }),
        }),
      );
      const developerResponse = await api._api.projects({ projectId: project.id }).releases({ releaseId: release.id }).publish.post(
        { message: null },
        { headers: { authorization: `Bearer ${refreshToken}` } },
      );
      expect(developerResponse.status).toBe(403);
      expect((developerResponse.error?.value as unknown)).toEqual({ code: "FORBIDDEN" });

      await app.handle(
        new Request("http://localhost/_api/__test/memberRole", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ userId: project.createdBy, organizationId: project.organizationId, role: "viewer" }),
        }),
      );
      const viewerResponse = await api._api.projects({ projectId: project.id }).releases({ releaseId: release.id }).publish.post(
        { message: null },
        { headers: { authorization: `Bearer ${refreshToken}` } },
      );
      expect(viewerResponse.status).toBe(403);
      expect((viewerResponse.error?.value as unknown)).toEqual({ code: "FORBIDDEN" });
    } finally {
      rmSync(storageRoot, { recursive: true, force: true });
    }
  });

  test("rejects publish for unknown project, unknown release, and release from another project", async () => {
    const storageRoot = createTempStorageRoot();
    try {
      const api = treaty(createApp({ storageRoot, exposeTestRoutes: true }));
      const first = await registerLoginAndCreateProject(api);
      const second = await registerLoginAndCreateProject(api);
      const otherRelease = await createReadyRelease(api, second.project.id, second.refreshToken);

      const unknownProject = await api._api.projects({ projectId: "missing-project" }).releases({ releaseId: otherRelease.id }).publish.post(
        { message: null },
        { headers: { authorization: `Bearer ${first.refreshToken}` } },
      );
      expect(unknownProject.status).toBe(404);
      expect((unknownProject.error?.value as unknown)).toEqual({ code: "PROJECT_NOT_FOUND" });

      const unknownRelease = await api._api.projects({ projectId: first.project.id }).releases({ releaseId: "missing-release" }).publish.post(
        { message: null },
        { headers: { authorization: `Bearer ${first.refreshToken}` } },
      );
      expect(unknownRelease.status).toBe(404);
      expect((unknownRelease.error?.value as unknown)).toEqual({ code: "RELEASE_NOT_FOUND" });

      const wrongProject = await api._api.projects({ projectId: first.project.id }).releases({ releaseId: otherRelease.id }).publish.post(
        { message: null },
        { headers: { authorization: `Bearer ${first.refreshToken}` } },
      );
      expect(wrongProject.status).toBe(404);
      expect((wrongProject.error?.value as unknown)).toEqual({ code: "RELEASE_NOT_FOUND" });
    } finally {
      rmSync(storageRoot, { recursive: true, force: true });
    }
  });

  test("rejects publish for releases that are not ready or are archived", async () => {
    const storageRoot = createTempStorageRoot();
    try {
      const app = createApp({ storageRoot, exposeTestRoutes: true });
      const api = treaty(app);
      const { refreshToken, project } = await registerLoginAndCreateProject(api);
      const release = await createReadyRelease(api, project.id, refreshToken);

      for (const statusValue of ["uploading", "processing", "failed", "archived", "deleted"] as const) {
        await app.handle(
          new Request("http://localhost/_api/__test/releaseState", {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ releaseId: release.id, status: statusValue, archived: false }),
          }),
        );
        const response = await api._api.projects({ projectId: project.id }).releases({ releaseId: release.id }).publish.post(
          { message: null },
          { headers: { authorization: `Bearer ${refreshToken}` } },
        );
        expect(response.status).toBe(409);
        expect((response.error?.value as unknown)).toEqual({ code: "RELEASE_NOT_READY" });
      }

      await app.handle(
        new Request("http://localhost/_api/__test/releaseState", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ releaseId: release.id, status: "ready", archived: true }),
        }),
      );
      const archivedResponse = await api._api.projects({ projectId: project.id }).releases({ releaseId: release.id }).publish.post(
        { message: null },
        { headers: { authorization: `Bearer ${refreshToken}` } },
      );
      expect(archivedResponse.status).toBe(409);
      expect((archivedResponse.error?.value as unknown)).toEqual({ code: "RELEASE_NOT_READY" });
    } finally {
      rmSync(storageRoot, { recursive: true, force: true });
    }
  });

  test("publishing a second release moves the previous active release back to ready", async () => {
    const storageRoot = createTempStorageRoot();
    try {
      const api = treaty(createApp({ storageRoot, exposeTestRoutes: true }));
      const { refreshToken, project } = await registerLoginAndCreateProject(api);
      const firstRelease = await createReadyRelease(api, project.id, refreshToken);
      const secondRelease = await createReadyRelease(api, project.id, refreshToken);

      await api._api.projects({ projectId: project.id }).releases({ releaseId: firstRelease.id }).publish.post(
        { message: "Ship v1" },
        { headers: { authorization: `Bearer ${refreshToken}` } },
      );
      const response = await api._api.projects({ projectId: project.id }).releases({ releaseId: secondRelease.id }).publish.post(
        { message: "Ship v2" },
        { headers: { authorization: `Bearer ${refreshToken}` } },
      );

      expect(response.status).toBe(200);
      expect(response.data?.deployment.previousReleaseId).toBe(firstRelease.id);
      expect(response.data?.release).toMatchObject({
        id: secondRelease.id,
        status: "active",
      });
      expect(response.data?.previousRelease).toMatchObject({
        id: firstRelease.id,
        status: "ready",
      });

      const releases = await api._api.projects({ projectId: project.id }).releases.get({
        headers: { authorization: `Bearer ${refreshToken}` },
      });
      const firstAfter = releases.data?.releases.find((candidate) => candidate.id === firstRelease.id);
      const secondAfter = releases.data?.releases.find((candidate) => candidate.id === secondRelease.id);
      expect(firstAfter?.status).toBe("ready");
      expect(secondAfter?.status).toBe("active");
    } finally {
      rmSync(storageRoot, { recursive: true, force: true });
    }
  });


  test("rolls back to a previous ready release and records deployment and audit", async () => {
    const storageRoot = createTempStorageRoot();
    try {
      const app = createApp({ storageRoot, exposeTestRoutes: true });
      const api = treaty(app);
      const { refreshToken, project } = await registerLoginAndCreateProject(api);
      const firstRelease = await createReadyRelease(api, project.id, refreshToken);
      const secondRelease = await createReadyRelease(api, project.id, refreshToken);

      await api._api.projects({ projectId: project.id }).releases({ releaseId: firstRelease.id }).publish.post(
        { message: "Ship v1" },
        { headers: { authorization: `Bearer ${refreshToken}` } },
      );
      await api._api.projects({ projectId: project.id }).releases({ releaseId: secondRelease.id }).publish.post(
        { message: "Ship v2" },
        { headers: { authorization: `Bearer ${refreshToken}` } },
      );

      const response = await api._api.projects({ projectId: project.id }).releases({ releaseId: firstRelease.id }).rollback.post(
        { message: "Back to v1" },
        { headers: { authorization: `Bearer ${refreshToken}` } },
      );

      expect(response.status).toBe(200);
      expect(response.data?.deployment).toMatchObject({
        projectId: project.id,
        releaseId: firstRelease.id,
        previousReleaseId: secondRelease.id,
        action: "rollback",
        status: "success",
        message: "Back to v1",
      });
      expect(response.data?.project.currentReleaseId).toBe(firstRelease.id);
      expect(response.data?.release).toMatchObject({ id: firstRelease.id, status: "active" });
      expect(response.data?.previousRelease).toMatchObject({ id: secondRelease.id, status: "ready" });

      const auditLogs = await listAuditLogs(app);
      expect(auditLogs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            projectId: project.id,
            action: "release.rolled_back",
            targetType: "release",
            targetId: firstRelease.id,
            metadata: expect.objectContaining({
              releaseId: firstRelease.id,
              previousReleaseId: secondRelease.id,
              message: "Back to v1",
            }),
          }),
        ]),
      );

      const currentPath = join(storageRoot, "sites", project.slug, "current");
      expect(readLinkTarget(currentPath)).toBe(`releases/${firstRelease.releaseHash}`);
    } finally {
      rmSync(storageRoot, { recursive: true, force: true });
    }
  });

  test("rejects rollback without permission, to current release, and to non-ready releases", async () => {
    const storageRoot = createTempStorageRoot();
    try {
      const app = createApp({ storageRoot, exposeTestRoutes: true });
      const api = treaty(app);
      const { refreshToken, project } = await registerLoginAndCreateProject(api);
      const firstRelease = await createReadyRelease(api, project.id, refreshToken);
      const secondRelease = await createReadyRelease(api, project.id, refreshToken);

      await api._api.projects({ projectId: project.id }).releases({ releaseId: firstRelease.id }).publish.post(
        { message: "Ship v1" },
        { headers: { authorization: `Bearer ${refreshToken}` } },
      );

      const currentResponse = await api._api.projects({ projectId: project.id }).releases({ releaseId: firstRelease.id }).rollback.post(
        { message: null },
        { headers: { authorization: `Bearer ${refreshToken}` } },
      );
      expect(currentResponse.status).toBe(409);
      expect((currentResponse.error?.value as unknown)).toEqual({ code: "RELEASE_ALREADY_ACTIVE" });

      await app.handle(
        new Request("http://localhost/_api/__test/memberRole", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ userId: project.createdBy, organizationId: project.organizationId, role: "developer" }),
        }),
      );
      const forbiddenResponse = await api._api.projects({ projectId: project.id }).releases({ releaseId: secondRelease.id }).rollback.post(
        { message: null },
        { headers: { authorization: `Bearer ${refreshToken}` } },
      );
      expect(forbiddenResponse.status).toBe(403);
      expect((forbiddenResponse.error?.value as unknown)).toEqual({ code: "FORBIDDEN" });

      await app.handle(
        new Request("http://localhost/_api/__test/memberRole", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ userId: project.createdBy, organizationId: project.organizationId, role: "owner" }),
        }),
      );
      await app.handle(
        new Request("http://localhost/_api/__test/releaseState", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ releaseId: secondRelease.id, status: "failed", archived: false }),
        }),
      );
      const failedResponse = await api._api.projects({ projectId: project.id }).releases({ releaseId: secondRelease.id }).rollback.post(
        { message: null },
        { headers: { authorization: `Bearer ${refreshToken}` } },
      );
      expect(failedResponse.status).toBe(409);
      expect((failedResponse.error?.value as unknown)).toEqual({ code: "RELEASE_NOT_ROLLBACKABLE" });
    } finally {
      rmSync(storageRoot, { recursive: true, force: true });
    }
  });

  test("lists deployments newest first for project viewers", async () => {
    const storageRoot = createTempStorageRoot();
    try {
      const api = treaty(createApp({ storageRoot, exposeTestRoutes: true }));
      const { refreshToken, project } = await registerLoginAndCreateProject(api);
      const firstRelease = await createReadyRelease(api, project.id, refreshToken);
      const secondRelease = await createReadyRelease(api, project.id, refreshToken);

      await api._api.projects({ projectId: project.id }).releases({ releaseId: firstRelease.id }).publish.post(
        { message: "Ship v1" },
        { headers: { authorization: `Bearer ${refreshToken}` } },
      );
      await api._api.projects({ projectId: project.id }).releases({ releaseId: secondRelease.id }).publish.post(
        { message: "Ship v2" },
        { headers: { authorization: `Bearer ${refreshToken}` } },
      );
      await api._api.projects({ projectId: project.id }).releases({ releaseId: firstRelease.id }).rollback.post(
        { message: "Back to v1" },
        { headers: { authorization: `Bearer ${refreshToken}` } },
      );

      const response = await api._api.projects({ projectId: project.id }).deployments.get({
        headers: { authorization: `Bearer ${refreshToken}` },
      });

      expect(response.status).toBe(200);
      expect(response.data?.deployments.map((deployment) => deployment.action)).toEqual(["rollback", "publish", "publish"]);
      expect(response.data?.deployments[0]?.releaseId).toBe(firstRelease.id);
    } finally {
      rmSync(storageRoot, { recursive: true, force: true });
    }
  });

  test("rejects publish when artifact index.html is missing without changing current release", async () => {
    const storageRoot = createTempStorageRoot();
    try {
      const api = treaty(createApp({ storageRoot, exposeTestRoutes: true }));
      const { refreshToken, project } = await registerLoginAndCreateProject(api);
      const release = await createReadyRelease(api, project.id, refreshToken);

      rmSync(join(release.storagePath, "index.html"));

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

});
