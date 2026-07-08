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

async function registerAndLogin() {
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

  return {
    api,
    refreshToken: login.data?.session.refreshToken ?? "",
  };
}

describe("organizations routes", () => {
  test("lists the current user's default organization and role", async () => {
    const { api, refreshToken } = await registerAndLogin();

    const response = await api._api.organizations.get({
      headers: {
        authorization: `Bearer ${refreshToken}`,
      },
    });

    expect(response.status).toBe(200);
    expect(response.data).toEqual({
      organizations: [
        {
          id: expect.any(String),
          name: "Ada Lovelace",
          slug: "ada",
          role: "owner",
        },
      ],
    });
  });

  test("returns unauthorized without a bearer token", async () => {
    const api = treaty(createApp({ db }));

    const response = await api._api.organizations.get();

    expect(response.status).toBe(401);
    expect((response.error?.value as unknown)).toEqual({
      code: "UNAUTHORIZED",
    });
  });
});
