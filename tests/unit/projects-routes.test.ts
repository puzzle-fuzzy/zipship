import { treaty } from "@elysia/eden";
import { describe, expect, test } from "bun:test";
import { createApp } from "../../apps/api/src/index";

async function registerLoginAndGetOrganization() {
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

  return {
    api,
    refreshToken,
    organizationId: organizations.data?.organizations[0]?.id ?? "",
  };
}

describe("projects routes", () => {
  test("returns a project detail by id", async () => {
    const { api, refreshToken, organizationId } = await registerLoginAndGetOrganization();
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
    expect(created.data?.project).toBeDefined();
    const projectId = created.data?.project.id ?? "";
    const project = created.data?.project;

    if (!project) {
      throw new Error("Project creation unexpectedly returned no project");
    }

    const response = await api._api.projects({ projectId }).get({
      headers: {
        authorization: `Bearer ${refreshToken}`,
      },
    });

    expect(response.status).toBe(200);
    expect(response.data).toEqual({
      project,
    });
  });

  test("creates and lists projects for the current organization", async () => {
    const { api, refreshToken, organizationId } = await registerLoginAndGetOrganization();

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

    expect(created.status).toBe(201);
    expect(created.data).toMatchObject({
      project: {
        id: expect.any(String),
        organizationId,
        name: "Marketing Site",
        slug: "marketing-site",
        description: "Launch pages",
        status: "active",
        visibility: "private",
        createdBy: expect.any(String),
      },
    });

    const listed = await api._api.organizations({ organizationId }).projects.get({
      headers: {
        authorization: `Bearer ${refreshToken}`,
      },
    });

    expect(listed.status).toBe(200);
    expect(listed.data).toMatchObject({
      projects: [
        {
          id: created.data?.project.id,
          organizationId,
          name: "Marketing Site",
          slug: "marketing-site",
          description: "Launch pages",
          status: "active",
          visibility: "private",
        },
      ],
    });
  });

  test("returns unauthorized without a bearer token", async () => {
    const api = treaty(createApp());

    const response = await api._api.organizations({ organizationId: "org-1" }).projects.get();

    expect(response.status).toBe(401);
    expect((response.error?.value as unknown)).toEqual({
      code: "UNAUTHORIZED",
    });
  });

  test("returns unauthorized for project detail without a bearer token", async () => {
    const api = treaty(createApp());

    const response = await api._api.projects({ projectId: "project-1" }).get();

    expect(response.status).toBe(401);
    expect((response.error?.value as unknown)).toEqual({
      code: "UNAUTHORIZED",
    });
  });

  test("returns not found for an unknown project id", async () => {
    const { api, refreshToken } = await registerLoginAndGetOrganization();

    const response = await api._api.projects({ projectId: "missing-project" }).get({
      headers: {
        authorization: `Bearer ${refreshToken}`,
      },
    });

    expect(response.status).toBe(404);
    expect((response.error?.value as unknown)).toEqual({
      code: "PROJECT_NOT_FOUND",
    });
  });

  test("rejects invalid project slugs", async () => {
    const { api, refreshToken, organizationId } = await registerLoginAndGetOrganization();

    const response = await api._api.organizations({ organizationId }).projects.post(
      {
        name: "Admin",
        slug: "_admin",
        description: null,
      },
      {
        headers: {
          authorization: `Bearer ${refreshToken}`,
        },
      },
    );

    expect(response.status).toBe(400);
    expect((response.error?.value as unknown)).toEqual({
      code: "INVALID_PROJECT_INPUT",
    });
  });
});
