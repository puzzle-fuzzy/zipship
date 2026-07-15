import { beforeEach, describe, expect, it, vi } from "vitest";
import { getThrownApiErrorCode } from "../src/api/errors";
import { createMockApi, type MockApi } from "./helpers/mockApi";

const { mockApi, setMockApi } = vi.hoisted(() => {
  let current: unknown;
  return {
    mockApi: () => current,
    setMockApi: (api: unknown) => {
      current = api;
    },
  };
});

vi.mock("../src/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/api/client")>();
  return { ...actual, getApi: () => mockApi() };
});

const { createApiToken, listApiTokens, revokeApiToken } = await import(
  "../src/features/settings/apiTokens"
);

let api: MockApi;
const token = {
  id: "token-1",
  name: "Production deploy",
  displayPrefix: "zps_12345678",
  scopes: ["projects:read", "deployments:write"] as const,
  state: "active" as const,
  expiresAt: "2026-08-14T00:00:00Z",
  lastUsedAt: null,
  revokedAt: null,
  createdAt: "2026-07-15T00:00:00Z",
};

beforeEach(() => {
  api = createMockApi();
  setMockApi(api._api);
  document.cookie = "zipship_csrf=test-csrf; Path=/";
});

describe("API token client", () => {
  it("lists only the safe token metadata returned by the Rust API", async () => {
    api.verb("get").mockResolvedValueOnce({ data: { apiTokens: [token] } });

    await expect(listApiTokens()).resolves.toEqual([token]);
    expect(api.verb("get")).toHaveBeenCalledWith("/_api/api-tokens");
  });

  it("creates a scoped token with CSRF and returns the one-time secret to its caller", async () => {
    const issued = { apiToken: token, secret: "zps_one-time-secret" };
    api.verb("post").mockResolvedValueOnce({ data: issued });

    await expect(
      createApiToken({
        name: "Production deploy",
        scopes: ["projects:read", "deployments:write"],
        expiresInDays: 30,
      }),
    ).resolves.toEqual(issued);
    expect(api.verb("post")).toHaveBeenCalledWith("/_api/api-tokens", {
      params: { header: { "x-csrf-token": "test-csrf" } },
      body: {
        name: "Production deploy",
        scopes: ["projects:read", "deployments:write"],
        expiresInDays: 30,
      },
    });
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it("revokes the current user's token with CSRF", async () => {
    api.verb("delete").mockResolvedValueOnce({});

    await revokeApiToken("token-1");
    expect(api.verb("delete")).toHaveBeenCalledWith(
      "/_api/api-tokens/{token_id}",
      {
        params: {
          path: { token_id: "token-1" },
          header: { "x-csrf-token": "test-csrf" },
        },
      },
    );
  });

  it("retains stable Rust error codes for localized UI messages", async () => {
    api
      .verb("post")
      .mockResolvedValueOnce({ error: { code: "API_TOKEN_LIMIT_REACHED" } });

    const promise = createApiToken({
      name: "Too many",
      scopes: ["projects:read"],
      expiresInDays: 30,
    });
    await expect(promise).rejects.toThrow("Failed to create API token");
    await promise.catch((error) =>
      expect(getThrownApiErrorCode(error)).toBe("API_TOKEN_LIMIT_REACHED"),
    );
  });
});
