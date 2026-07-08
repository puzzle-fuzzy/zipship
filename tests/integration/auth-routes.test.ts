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

  test("accepts password at minimum length (8 chars)", async () => {
    const api = treaty(createApp({ db }));

    const response = await api._api.auth.register.post({
      name: "Min Password",
      email: "minpw@example.com",
      password: "12345678",
    });

    expect(response.status).toBe(201);
  });

  test("accepts password at maximum length (128 chars)", async () => {
    const api = treaty(createApp({ db }));

    const response = await api._api.auth.register.post({
      name: "Max Password",
      email: "maxpw@example.com",
      password: "a".repeat(128),
    });

    expect(response.status).toBe(201);
  });

  test("rejects password one above minimum (7 chars) on register", async () => {
    const api = treaty(createApp({ db }));

    const response = await api._api.auth.register.post({
      name: "Ada",
      email: "short@example.com",
      password: "1234567",
    });

    expect(response.status).toBe(400);
  });

  test("rejects password one above maximum (129 chars) on register", async () => {
    const api = treaty(createApp({ db }));

    const response = await api._api.auth.register.post({
      name: "Too Long",
      email: "toolongpw@example.com",
      password: "a".repeat(129),
    });

    expect(response.status).toBe(400);
  });

  test("accepts lowercase 'bearer' scheme", async () => {
    const api = treaty(createApp({ db }));

    await api._api.auth.register.post({
      name: "Ada",
      email: "ada-bearer@example.com",
      password: "correct-horse-battery",
    });

    const login = await api._api.auth.login.post({
      email: "ada-bearer@example.com",
      password: "correct-horse-battery",
    });

    const response = await api._api.auth.me.get({
      headers: {
        authorization: `bearer ${login.data?.session.refreshToken}`,
      },
    });

    expect(response.status).toBe(200);
    expect(response.data?.user.email).toBe("ada-bearer@example.com");
  });

  test("rejects 'NotBearer ' scheme on /me", async () => {
    const api = treaty(createApp({ db }));

    const response = await api._api.auth.me.get({
      headers: { authorization: "NotBearer token" },
    });

    expect(response.status).toBe(401);
  });

  test("rejects empty Bearer token on /me", async () => {
    const api = treaty(createApp({ db }));

    const response = await api._api.auth.me.get({
      headers: { authorization: "Bearer " },
    });

    expect(response.status).toBe(401);
  });

  test("logout revokes session and subsequent /me fails", async () => {
    const api = treaty(createApp({ db }));

    const registerRes = await api._api.auth.register.post({
      name: "Logout Test",
      email: "logout@test.com",
      password: "correct-horse-battery",
    });
    const token = registerRes.data!.session.refreshToken;

    // /me works before logout
    const before = await api._api.auth.me.get({
      headers: { authorization: `Bearer ${token}` },
    });
    expect(before.status).toBe(200);

    // Logout (no body on POST, pass undefined then options)
    const logoutRes = await api._api.auth.logout.post(undefined, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(logoutRes.status).toBe(200);
    expect(logoutRes.data).toEqual({ ok: true });

    // /me fails after logout
    const after = await api._api.auth.me.get({
      headers: { authorization: `Bearer ${token}` },
    });
    expect(after.status).toBe(401);
  });

  test("logout with invalid token returns 401", async () => {
    const api = treaty(createApp({ db }));

    const response = await api._api.auth.logout.post(undefined, {
      headers: { authorization: "Bearer invalid-token" },
    });

    expect(response.status).toBe(401);
  });

  test("logout without authorization header returns 401", async () => {
    const api = treaty(createApp({ db }));

    const response = await api._api.auth.logout.post();

    expect(response.status).toBe(401);
  });

  test("revoked session returns 401 on organizations route", async () => {
    const api = treaty(createApp({ db }));

    const registerRes = await api._api.auth.register.post({
      name: "Revoked Session",
      email: "revoked@test.com",
      password: "correct-horse-battery",
    });
    const token = registerRes.data!.session.refreshToken;

    // Logout to revoke the session
    await api._api.auth.logout.post(undefined, {
      headers: { authorization: `Bearer ${token}` },
    });

    // Organization list with revoked session should fail
    const orgRes = await api._api.organizations.get({
      headers: { authorization: `Bearer ${token}` },
    });
    expect(orgRes.status).toBe(401);
  });

  test("error response has exactly { code } with no extra fields", async () => {
    const api = treaty(createApp({ db }));

    const response = await api._api.auth.me.get();

    expect(response.status).toBe(401);
    expect(response.error?.value).toEqual({ code: "UNAUTHORIZED" });
    // Verify no extra fields like "message" or "stack"
    expect(Object.keys(response.error!.value as object)).toEqual(["code"]);
  });

  test("multiple failed logins do not change error code", async () => {
    const api = treaty(createApp({ db }));

    // Create user
    await api._api.auth.register.post({
      name: "Brute Force",
      email: "brute@test.com",
      password: "correct-horse-battery",
    });

    // Multiple failed attempts with different wrong passwords
    for (let i = 0; i < 5; i++) {
      const response = await api._api.auth.login.post({
        email: "brute@test.com",
        password: `wrong-attempt-${i}`,
        clientType: "web",
      });

      expect(response.status).toBe(401);
      expect((response.error?.value as unknown)).toEqual({ code: "INVALID_CREDENTIALS" });
    }

    // Correct password still works after failed attempts
    const success = await api._api.auth.login.post({
      email: "brute@test.com",
      password: "correct-horse-battery",
      clientType: "web",
    });
    expect(success.status).toBe(200);
  });

  test("session from registration works for immediate downstream API access", async () => {
    const api = treaty(createApp({ db }));

    const registerRes = await api._api.auth.register.post({
      name: "Downstream API",
      email: "downstream@test.com",
      password: "correct-horse-battery",
    });
    const token = registerRes.data!.session.refreshToken;

    // Organizations list (downstream API) using registration session
    const orgRes = await api._api.organizations.get({
      headers: { authorization: `Bearer ${token}` },
    });

    expect(orgRes.status).toBe(200);
    expect(orgRes.data?.organizations).toHaveLength(1);
    expect(orgRes.data?.organizations[0].name).toBe("Downstream API");
  });
});
