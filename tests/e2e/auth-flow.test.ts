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

describe("auth flow (e2e)", () => {
  test("register → me (session works) → organizations (can list)", async () => {
    const api = treaty(createApp({ db }));

    // 1. Register
    const registerRes = await api._api.auth.register.post({
      name: "Alice Wang",
      email: "alice@example.com",
      password: "secure-password-123",
    });

    expect(registerRes.status).toBe(201);
    expect(registerRes.data).toMatchObject({
      user: { email: "alice@example.com" },
      organization: { slug: "alice" },
      member: { role: "owner" },
    });
    expect(registerRes.data?.session.refreshToken).toBeString();

    const token = registerRes.data!.session.refreshToken;

    // 2. Immediately use /me with the registration session token
    const meRes = await api._api.auth.me.get({
      headers: { authorization: `Bearer ${token}` },
    });

    expect(meRes.status).toBe(200);
    expect(meRes.data).toMatchObject({
      user: { email: "alice@example.com" },
      session: { clientType: "web" },
    });

    // 3. List organizations — requires auth, proves session works for downstream APIs
    const orgsRes = await api._api.organizations.get({
      headers: { authorization: `Bearer ${token}` },
    });

    expect(orgsRes.status).toBe(200);
    expect(orgsRes.data?.organizations).toHaveLength(1);
    expect(orgsRes.data?.organizations[0]).toMatchObject({
      slug: "alice",
      role: "owner",
    });
  });

  test("register → login again → both sessions work independently", async () => {
    const api = treaty(createApp({ db }));

    // Register once
    const registerRes = await api._api.auth.register.post({
      name: "Bob Chen",
      email: "bob@example.com",
      password: "another-secure-pw",
    });
    expect(registerRes.status).toBe(201);
    const regToken = registerRes.data!.session.refreshToken;

    // Login again (second device / tab)
    const loginRes = await api._api.auth.login.post({
      email: "bob@example.com",
      password: "another-secure-pw",
      clientType: "desktop",
    });
    expect(loginRes.status).toBe(200);
    expect(loginRes.data?.session.refreshToken).not.toBe(regToken);
    expect(loginRes.data?.session.clientType).toBe("desktop");
    const loginToken = loginRes.data!.session.refreshToken;

    // Both sessions should be valid independently
    const [regMe, loginMe] = await Promise.all([
      api._api.auth.me.get({ headers: { authorization: `Bearer ${regToken}` } }),
      api._api.auth.me.get({ headers: { authorization: `Bearer ${loginToken}` } }),
    ]);

    expect(regMe.status).toBe(200);
    expect(loginMe.status).toBe(200);
    expect(regMe.data?.user.email).toBe("bob@example.com");
    expect(loginMe.data?.user.email).toBe("bob@example.com");
    expect(regMe.data?.session.id).not.toBe(loginMe.data?.session.id);
  });

  test("register → login with wrong password → still 401, not leaked", async () => {
    const api = treaty(createApp({ db }));

    // Register
    await api._api.auth.register.post({
      name: "Carol",
      email: "carol@example.com",
      password: "carols-password",
    });

    // Try wrong password — must return INVALID_CREDENTIALS, not DUPLICATE_EMAIL or anything else
    const badLogin = await api._api.auth.login.post({
      email: "carol@example.com",
      password: "wrong-wrong-wrong",
      clientType: "web",
    });

    expect(badLogin.status).toBe(401);
    expect((badLogin.error?.value as unknown)).toEqual({
      code: "INVALID_CREDENTIALS",
    });

    // Correct login still works
    const goodLogin = await api._api.auth.login.post({
      email: "carol@example.com",
      password: "carols-password",
      clientType: "web",
    });
    expect(goodLogin.status).toBe(200);
  });

  test("register → logout (clear token) → /me fails", async () => {
    const api = treaty(createApp({ db }));

    const registerRes = await api._api.auth.register.post({
      name: "Logout Tester",
      email: "logout@example.com",
      password: "test-password-123",
    });
    expect(registerRes.status).toBe(201);

    const token = registerRes.data!.session.refreshToken;

    // Clear the token (simulating logout) and verify it's dead
    const deadMe = await api._api.auth.me.get();
    expect(deadMe.status).toBe(401);

    // The old token should still work (server-side sessions don't expire on logout yet)
    // This documents current behavior: no server-side session revocation on logout
    const stillValidMe = await api._api.auth.me.get({
      headers: { authorization: `Bearer ${token}` },
    });
    expect(stillValidMe.status).toBe(200);
  });

  test("register with desktop clientType creates desktop session", async () => {
    const api = treaty(createApp({ db }));

    const registerRes = await api._api.auth.register.post({
      name: "Desktop User",
      email: "desktop@example.com",
      password: "desktop-password",
      clientType: "desktop",
    });

    expect(registerRes.status).toBe(201);
    expect(registerRes.data?.session.clientType).toBe("desktop");

    const token = registerRes.data!.session.refreshToken;

    const meRes = await api._api.auth.me.get({
      headers: { authorization: `Bearer ${token}` },
    });
    expect(meRes.status).toBe(200);
    expect(meRes.data?.session.clientType).toBe("desktop");
  });

  test("multiple registrations return independent organizations", async () => {
    const api = treaty(createApp({ db }));

    const user1 = await api._api.auth.register.post({
      name: "User One",
      email: "user1@example.com",
      password: "password-111",
    });
    expect(user1.status).toBe(201);

    const user2 = await api._api.auth.register.post({
      name: "User Two",
      email: "user2@example.com",
      password: "password-222",
    });
    expect(user2.status).toBe(201);

    // Each user should see only their own organization
    const [orgs1, orgs2] = await Promise.all([
      api._api.organizations.get({
        headers: { authorization: `Bearer ${user1.data!.session.refreshToken}` },
      }),
      api._api.organizations.get({
        headers: { authorization: `Bearer ${user2.data!.session.refreshToken}` },
      }),
    ]);

    expect(orgs1.data?.organizations).toHaveLength(1);
    expect(orgs1.data?.organizations[0].slug).toBe("user1");
    expect(orgs2.data?.organizations).toHaveLength(1);
    expect(orgs2.data?.organizations[0].slug).toBe("user2");
  });

  test("preserves case-insensitive email normalization across register and login", async () => {
    const api = treaty(createApp({ db }));

    // Register with mixed case
    const registerRes = await api._api.auth.register.post({
      name: "Case Test",
      email: "  CaseMIX@Example.COM ",
      password: "case-test-pw",
    });
    expect(registerRes.status).toBe(201);

    const token = registerRes.data!.session.refreshToken;

    // /me should return normalized lowercased email
    const meRes = await api._api.auth.me.get({
      headers: { authorization: `Bearer ${token}` },
    });
    expect(meRes.data?.user.email).toBe("casemix@example.com");

    // Login with different casing should work
    const loginRes = await api._api.auth.login.post({
      email: "  CASEMIX@example.com ",
      password: "case-test-pw",
      clientType: "web",
    });
    expect(loginRes.status).toBe(200);
    expect(loginRes.data?.user.email).toBe("casemix@example.com");
  });
});
