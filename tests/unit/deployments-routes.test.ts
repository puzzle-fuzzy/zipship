import { treaty } from "@elysia/eden";
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createApp } from "../../apps/api/src/index";

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

describe("deployments routes", () => {
  test("publishes a ready release and records deployment and audit", async () => {
    const storageRoot = createTempStorageRoot();
    try {
      const api = treaty(createApp({ storageRoot, exposeTestRoutes: true }));
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

      const auditResponse = await (api._api as any).__test.auditLogs.get();
      expect(auditResponse.status).toBe(200);
      expect(auditResponse.data?.auditLogs).toEqual(
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
    } finally {
      rmSync(storageRoot, { recursive: true, force: true });
    }
  });
});
