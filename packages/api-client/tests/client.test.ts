import { expect, test } from "bun:test";
import { createApiClient, csrfHeaders, readCsrfToken } from "../src";

test("reads the non-HttpOnly CSRF cookie without retaining session secrets", () => {
  const cookies = "theme=night; zipship_csrf=token%2Evalue; ignored=1";
  expect(readCsrfToken(cookies)).toBe("token.value");
  expect(csrfHeaders(cookies)).toEqual({ "x-csrf-token": "token.value" });
  expect(readCsrfToken("zipship_session=secret")).toBeNull();
  expect(() => csrfHeaders("zipship_session=secret")).toThrow(
    "CSRF token cookie is missing",
  );
});

test("binds anonymous password recovery without exposing the token in the URL", async () => {
  const requests: Request[] = [];
  const token = "r".repeat(43);
  const api = createApiClient("https://control.example.test", {
    fetch: async (input) => {
      requests.push(input);
      return new Response(null, {
        status: input.url.endsWith("/confirm") ? 204 : 202,
      });
    },
  });

  const requested = await api.POST("/_api/auth/password-resets", {
    body: { email: "owner@example.com" },
  });
  const confirmed = await api.POST("/_api/auth/password-resets/confirm", {
    body: {
      token,
      password: "new correct horse battery staple",
    },
  });

  expect(requested.error).toBeUndefined();
  expect(confirmed.error).toBeUndefined();
  expect(requests[0]?.url).toBe(
    "https://control.example.test/_api/auth/password-resets",
  );
  expect(requests[1]?.url).toBe(
    "https://control.example.test/_api/auth/password-resets/confirm",
  );
  expect(requests[1]?.url).not.toContain(token);
  expect(requests[1]?.headers.get("x-csrf-token")).toBeNull();
  expect(await requests[1]?.clone().json()).toEqual({
    token,
    password: "new correct horse battery staple",
  });
});

test("binds generated deployment paths and includes browser credentials", async () => {
  let request: Request | undefined;
  const api = createApiClient("https://control.example.test/", {
    fetch: async (input) => {
      request = input;
      return Response.json({
        deployment: {
          id: "00000000-0000-0000-0000-000000000003",
          projectId: "00000000-0000-0000-0000-000000000001",
          releaseId: "00000000-0000-0000-0000-000000000002",
          previousReleaseId: null,
          action: "publish",
          status: "succeeded",
          actorId: "00000000-0000-0000-0000-000000000004",
          message: null,
          createdAt: "2026-07-15T00:00:00Z",
          finishedAt: "2026-07-15T00:00:00Z",
        },
        activeReleaseId: "00000000-0000-0000-0000-000000000002",
        replayed: false,
      });
    },
  });

  const result = await api.POST(
    "/_api/projects/{project_id}/releases/{release_id}/publish",
    {
      params: {
        path: {
          project_id: "00000000-0000-0000-0000-000000000001",
          release_id: "00000000-0000-0000-0000-000000000002",
        },
        header: {
          "idempotency-key": "publish-v1",
          "x-csrf-token": "csrf-token",
        },
      },
      body: { message: "Production release" },
    },
  );

  expect(result.error).toBeUndefined();
  expect(result.data?.deployment.action).toBe("publish");
  expect(request?.url).toBe(
    "https://control.example.test/_api/projects/00000000-0000-0000-0000-000000000001/releases/00000000-0000-0000-0000-000000000002/publish",
  );
  expect(request?.credentials).toBe("include");
  expect(request?.headers.get("idempotency-key")).toBe("publish-v1");
  expect(request?.headers.get("x-csrf-token")).toBe("csrf-token");
});

test("binds the generated current-user profile update contract", async () => {
  let request: Request | undefined;
  const api = createApiClient("https://control.example.test", {
    fetch: async (input) => {
      request = input;
      return Response.json({
        user: {
          id: "00000000-0000-0000-0000-000000000001",
          email: "owner@example.com",
          displayName: "Product Owner",
        },
      });
    },
  });

  const result = await api.PATCH("/_api/auth/me", {
    params: {
      header: { "x-csrf-token": "csrf-token" },
    },
    body: { displayName: "Product Owner" },
  });

  expect(result.error).toBeUndefined();
  expect(result.data?.user.displayName).toBe("Product Owner");
  expect(request?.method).toBe("PATCH");
  expect(request?.url).toBe("https://control.example.test/_api/auth/me");
  expect(request?.credentials).toBe("include");
  expect(request?.headers.get("x-csrf-token")).toBe("csrf-token");
  expect(await request?.clone().json()).toEqual({
    displayName: "Product Owner",
  });
});

test("binds the generated member role update contract", async () => {
  let request: Request | undefined;
  const api = createApiClient("https://control.example.test", {
    fetch: async (input) => {
      request = input;
      return Response.json({
        member: {
          userId: "00000000-0000-0000-0000-000000000002",
          email: "member@example.com",
          displayName: "Member",
          role: "owner",
          joinedAt: "2026-07-15T00:00:00Z",
        },
      });
    },
  });

  const result = await api.PATCH(
    "/_api/organizations/{organization_id}/members/{user_id}",
    {
      params: {
        path: {
          organization_id: "00000000-0000-0000-0000-000000000001",
          user_id: "00000000-0000-0000-0000-000000000002",
        },
        header: { "x-csrf-token": "csrf-token" },
      },
      body: { role: "owner" },
    },
  );

  expect(result.error).toBeUndefined();
  expect(result.data?.member.role).toBe("owner");
  expect(request?.method).toBe("PATCH");
  expect(request?.url).toBe(
    "https://control.example.test/_api/organizations/00000000-0000-0000-0000-000000000001/members/00000000-0000-0000-0000-000000000002",
  );
  expect(request?.headers.get("x-csrf-token")).toBe("csrf-token");
  expect(await request?.clone().json()).toEqual({ role: "owner" });
});

test("binds the generated member removal contract", async () => {
  let request: Request | undefined;
  const api = createApiClient("https://control.example.test", {
    fetch: async (input) => {
      request = input;
      return new Response(null, { status: 204 });
    },
  });

  const result = await api.DELETE(
    "/_api/organizations/{organization_id}/members/{user_id}",
    {
      params: {
        path: {
          organization_id: "00000000-0000-0000-0000-000000000001",
          user_id: "00000000-0000-0000-0000-000000000002",
        },
        header: { "x-csrf-token": "csrf-token" },
      },
    },
  );

  expect(result.error).toBeUndefined();
  expect(request?.method).toBe("DELETE");
  expect(request?.url).toBe(
    "https://control.example.test/_api/organizations/00000000-0000-0000-0000-000000000001/members/00000000-0000-0000-0000-000000000002",
  );
  expect(request?.credentials).toBe("include");
  expect(request?.headers.get("x-csrf-token")).toBe("csrf-token");
});

test("binds invitation management without placing secrets in URLs", async () => {
  const requests: Request[] = [];
  const organizationId = "00000000-0000-0000-0000-000000000001";
  const invitationId = "00000000-0000-0000-0000-000000000002";
  const userId = "00000000-0000-0000-0000-000000000003";
  const token = "a".repeat(43);
  const invitation = {
    id: invitationId,
    organizationId,
    email: "invitee@example.com",
    role: "developer" as const,
    state: "pending" as const,
    invitedBy: userId,
    createdAt: "2026-07-15T00:00:00Z",
    expiresAt: "2026-07-22T00:00:00Z",
  };
  const api = createApiClient("https://control.example.test", {
    fetch: async (input) => {
      requests.push(input);
      if (input.method === "POST" && input.url.endsWith("/invitations")) {
        return Response.json({ invitation, acceptToken: token }, { status: 201 });
      }
      if (input.method === "POST") {
        return Response.json({
          invitationId,
          organizationId,
          userId,
          role: "developer",
          replayed: false,
        });
      }
      if (input.method === "GET") {
        return Response.json({ invitations: [invitation] });
      }
      return new Response(null, { status: 204 });
    },
  });

  const created = await api.POST(
    "/_api/organizations/{organization_id}/invitations",
    {
      params: {
        path: { organization_id: organizationId },
        header: { "x-csrf-token": "csrf-token" },
      },
      body: { email: "invitee@example.com", role: "developer" },
    },
  );
  const listed = await api.GET(
    "/_api/organizations/{organization_id}/invitations",
    { params: { path: { organization_id: organizationId } } },
  );
  const accepted = await api.POST("/_api/invitations/accept", {
    params: { header: { "x-csrf-token": "csrf-token" } },
    body: { token },
  });
  const revoked = await api.DELETE(
    "/_api/organizations/{organization_id}/invitations/{invitation_id}",
    {
      params: {
        path: {
          organization_id: organizationId,
          invitation_id: invitationId,
        },
        header: { "x-csrf-token": "csrf-token" },
      },
    },
  );

  expect(created.data?.acceptToken).toBe(token);
  expect(listed.data?.invitations[0]?.email).toBe("invitee@example.com");
  expect(accepted.data?.replayed).toBe(false);
  expect(revoked.error).toBeUndefined();
  expect(requests.map((request) => request.method)).toEqual([
    "POST",
    "GET",
    "POST",
    "DELETE",
  ]);
  expect(requests[2]?.url).toBe(
    "https://control.example.test/_api/invitations/accept",
  );
  expect(requests[2]?.url).not.toContain(token);
  expect(await requests[2]?.clone().json()).toEqual({ token });
  expect(requests[0]?.headers.get("x-csrf-token")).toBe("csrf-token");
  expect(requests[2]?.headers.get("x-csrf-token")).toBe("csrf-token");
  expect(requests[3]?.headers.get("x-csrf-token")).toBe("csrf-token");
});
