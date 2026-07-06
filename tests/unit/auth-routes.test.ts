import { treaty } from "@elysia/eden";
import { beforeEach, describe, expect, test } from "bun:test";
import { createApp } from "../../apps/api/src/index";
import { createTestDbClient } from "../../apps/api/src/db/client";
import { truncateAllTables } from "../../apps/api/src/db/test-utils";

const db = createTestDbClient(
  process.env.TEST_DATABASE_URL ?? "postgres://zipship:zipship@localhost:5432/zipship"
);

beforeEach(async () => {
  await truncateAllTables(db);
});

describe("auth routes", () => {
  test("registers a user through Eden Treaty", async () => {
    const api = treaty(createApp({ db }));

    const response = await api._api.auth.register.post({
      name: "Ada Lovelace",
      email: "ada@example.com",
      password: "correct-horse-battery",
    });

    expect(response.status).toBe(201);
    expect(response.data).toMatchObject({
      user: {
        email: "ada@example.com",
      },
      organization: {
        slug: "ada",
      },
      member: {
        role: "owner",
      },
    });
  });

  test("returns conflict for duplicate email addresses", async () => {
    const api = treaty(createApp({ db }));

    await api._api.auth.register.post({
      name: "Ada Lovelace",
      email: "ada@example.com",
      password: "correct-horse-battery",
    });

    const response = await api._api.auth.register.post({
      name: "Ada Again",
      email: " ADA@example.com ",
      password: "correct-horse-battery",
    });

    expect(response.status).toBe(409);
    expect((response.error?.value as unknown)).toEqual({
      code: "DUPLICATE_EMAIL",
    });
  });

  test("logs in a registered user through Eden Treaty", async () => {
    const api = treaty(createApp({ db }));

    await api._api.auth.register.post({
      name: "Ada Lovelace",
      email: "ada@example.com",
      password: "correct-horse-battery",
    });

    const response = await api._api.auth.login.post({
      email: " ADA@example.com ",
      password: "correct-horse-battery",
      clientType: "desktop",
    });

    expect(response.status).toBe(200);
    expect(response.data).toMatchObject({
      user: {
        email: "ada@example.com",
      },
      session: {
        clientType: "desktop",
      },
    });
    expect(response.data?.session.refreshToken).toBeString();
  });

  test("returns the current user for a bearer refresh token", async () => {
    const api = treaty(createApp({ db }));

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

    const response = await api._api.auth.me.get({
      headers: {
        authorization: `Bearer ${login.data?.session.refreshToken}`,
      },
    });

    expect(response.status).toBe(200);
    expect(response.data).toMatchObject({
      user: {
        email: "ada@example.com",
      },
      session: {
        clientType: "web",
      },
    });
  });

  test("returns unauthorized for missing current user token", async () => {
    const api = treaty(createApp({ db }));

    const response = await api._api.auth.me.get();

    expect(response.status).toBe(401);
    expect((response.error?.value as unknown)).toEqual({
      code: "UNAUTHORIZED",
    });
  });

  test("returns invalid credentials without revealing whether email exists", async () => {
    const api = treaty(createApp({ db }));

    const response = await api._api.auth.login.post({
      email: "missing@example.com",
      password: "wrong-password",
      clientType: "web",
    });

    expect(response.status).toBe(401);
    expect((response.error?.value as unknown)).toEqual({
      code: "INVALID_CREDENTIALS",
    });
  });

  test("returns 400 for short password on register", async () => {
    const api = treaty(createApp({ db }));

    const response = await api._api.auth.register.post({
      name: "Ada",
      email: "ada@example.com",
      password: "1234567",
    });

    expect(response.status).toBe(400);
    expect((response.error?.value as unknown)).toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  test("returns 400 for missing name on register", async () => {
    const api = treaty(createApp({ db }));

    const response = await api._api.auth.register.post({
      name: "",
      email: "ada@example.com",
      password: "correct-horse-battery",
    });

    expect(response.status).toBe(400);
  });

  test("returns invalid credentials for wrong password on existing user", async () => {
    const api = treaty(createApp({ db }));

    // Create a user first
    await api._api.auth.register.post({
      name: "Ada Lovelace",
      email: "ada@example.com",
      password: "correct-horse-battery",
    });

    // Login with wrong password — must not reveal the email exists
    const response = await api._api.auth.login.post({
      email: "ada@example.com",
      password: "wrong-password",
      clientType: "web",
    });

    expect(response.status).toBe(401);
    expect((response.error?.value as unknown)).toEqual({
      code: "INVALID_CREDENTIALS",
    });
  });

  test("registration returns a valid session token", async () => {
    const api = treaty(createApp({ db }));

    const registerRes = await api._api.auth.register.post({
      name: "Session Test",
      email: "session@test.com",
      password: "correct-horse-battery",
    });

    expect(registerRes.status).toBe(201);
    expect(registerRes.data?.session).toBeDefined();
    expect(registerRes.data?.session.refreshToken).toBeString();

    // The session from registration should work with /me
    const meRes = await api._api.auth.me.get({
      headers: {
        authorization: `Bearer ${registerRes.data!.session.refreshToken}`,
      },
    });

    expect(meRes.status).toBe(200);
    expect(meRes.data?.user.email).toBe("session@test.com");
  });

  test("returns 401 for expired or invalid session token on /me", async () => {
    const api = treaty(createApp({ db }));

    const responses = await Promise.all([
      api._api.auth.me.get(),
      api._api.auth.me.get({ headers: { authorization: "Bearer " } }),
      api._api.auth.me.get({ headers: { authorization: "NotBearer token" } }),
      api._api.auth.me.get({ headers: { authorization: "Bearer invalid-token-that-never-existed" } }),
    ]);

    for (const response of responses) {
      expect(response.status).toBe(401);
      expect((response.error?.value as unknown)).toEqual({ code: "UNAUTHORIZED" });
    }
  });

  test("rejects name exceeding database column limit (120 chars)", async () => {
    const api = treaty(createApp({ db }));

    const response = await api._api.auth.register.post({
      name: "x".repeat(121),
      email: "longname@example.com",
      password: "secure-password-123",
    });

    expect(response.status).toBe(400);
  });

  test("rejects email exceeding database column limit (255 chars)", async () => {
    const api = treaty(createApp({ db }));

    const response = await api._api.auth.register.post({
      name: "Long Email",
      email: `${"a".repeat(250)}@example.com`,
      password: "secure-password-123",
    });

    expect(response.status).toBe(400);
  });

  test("rejects password exceeding max length (128 chars)", async () => {
    const api = treaty(createApp({ db }));

    const response = await api._api.auth.register.post({
      name: "Long Password",
      email: "longpw@example.com",
      password: "a".repeat(129),
    });

    expect(response.status).toBe(400);
  });

  test("rejects login with email exceeding max length", async () => {
    const api = treaty(createApp({ db }));

    const response = await api._api.auth.login.post({
      email: `${"a".repeat(250)}@example.com`,
      password: "correct-horse-battery",
      clientType: "web",
    });

    expect(response.status).toBe(400);
  });
});
