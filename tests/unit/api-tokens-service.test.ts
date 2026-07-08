import { describe, expect, test } from "bun:test";
import { ApiTokensService, ApiTokensServiceError } from "../../apps/api/src/modules/api-tokens/service";

const NOW = new Date("2026-07-05T00:00:00.000Z");
const USER = { id: "user-1", name: "Ada Lovelace", email: "ada@example.com" };

function isErr(v: unknown) {
  return v instanceof ApiTokensServiceError;
}

/**
 * The api-tokens service authenticates via `resolvePrincipal`, which tries a
 * session first then falls back to an API token. We drive both seams through
 * the same injected collaborators: `sessionRepository` for refresh-token auth
 * and `apiTokensRepository` (which also satisfies `ApiTokenLookup`) for
 * token auth.
 */
function build(overrides: {
  authMode?: "session" | "api-token" | "none";
  revokeFound?: boolean;
  tokens?: Array<{ id: string; name: string; createdAt: Date; lastUsedAt: Date | null; revokedAt: Date | null }>;
  createdInvitations?: unknown[];
} = {}) {
  const authMode = overrides.authMode ?? "session";
  const created: unknown[] = [];

  const sessionRepository = {
    async findSessionByRefreshTokenHash(hash: string) {
      if (authMode !== "session" || hash !== "hashed:ada-refresh") return null;
      return {
        user: USER,
        session: { id: "s1", clientType: "web" as const, expiresAt: NOW.toISOString() },
      };
    },
  };

  const apiTokensRepository = {
    async findActiveApiTokenByHash(hash: string) {
      if (authMode !== "api-token" || hash !== "hashed:zship_tok") return null;
      return { userId: USER.id, name: USER.name, email: USER.email };
    },
    async touchApiTokenLastUsed(_hash: string, _now: Date) {
      // recorded implicitly by auth success
    },
    async createApiToken(input: { userId: string; name: string; tokenHash: string }) {
      created.push(input);
      return { id: "tok-1", name: input.name, createdAt: NOW };
    },
    async listApiTokensForUser(_userId: string) {
      return (
        overrides.tokens ?? [
          {
            id: "tok-1",
            name: "CI",
            createdAt: NOW,
            lastUsedAt: NOW,
            revokedAt: null,
          },
          {
            id: "tok-2",
            name: "Local",
            createdAt: NOW,
            lastUsedAt: null,
            revokedAt: null,
          },
        ]
      );
    },
    async revokeApiToken(_input: { userId: string; tokenId: string }) {
      return overrides.revokeFound ?? true;
    },
  };

  const service = new ApiTokensService({
    sessionRepository,
    apiTokensRepository,
    hashRefreshToken: async (t: string) => `hashed:${t}`,
    hashToken: async (t: string) => `hashed:${t}`,
    // randomToken returns a value with dashes; the service strips them and
    // prefixes `zship_`.
    randomToken: () => "abcd-efgh",
    now: () => NOW,
  });

  return { service, created };
}

function headersFor(mode: "session" | "api-token" | "none") {
  if (mode === "session") return { authorization: "Bearer ada-refresh" };
  if (mode === "api-token") return { authorization: "Bearer zship_tok" };
  return { authorization: "Bearer nobody" };
}

describe("api-tokens service > create", () => {
  test("creates a token via session auth and returns the plaintext once", async () => {
    const { service, created } = build({ authMode: "session" });

    const result = await service.create(headersFor("session"), { name: "CI" });

    expect(isErr(result)).toBe(false);
    if (isErr(result)) return;
    expect(result).toEqual({
      id: "tok-1",
      name: "CI",
      token: "zship_abcdefgh",
      createdAt: NOW.toISOString(),
    });
    // only the hash is persisted
    expect(created).toEqual([
      { userId: USER.id, name: "CI", tokenHash: "hashed:zship_abcdefgh" },
    ]);
  });

  test("creates a token via api-token auth (CLI re-auth)", async () => {
    const { service } = build({ authMode: "api-token" });
    const result = await service.create(headersFor("api-token"), { name: "CI" });
    expect(isErr(result)).toBe(false);
  });

  test("returns unauthorized when no principal can be resolved", async () => {
    const { service } = build({ authMode: "none" });
    const result = await service.create(headersFor("none"), { name: "CI" });
    expect(result).toBeInstanceOf(ApiTokensServiceError);
    expect((result as ApiTokensServiceError).code).toBe("UNAUTHORIZED");
  });
});

describe("api-tokens service > list", () => {
  test("lists active (non-revoked) tokens with ISO dates and nullable lastUsedAt", async () => {
    const { service } = build({ authMode: "session" });
    const result = await service.list(headersFor("session"));

    expect(isErr(result)).toBe(false);
    if (isErr(result)) return;
    expect(result.tokens).toEqual([
      { id: "tok-1", name: "CI", createdAt: NOW.toISOString(), lastUsedAt: NOW.toISOString() },
      { id: "tok-2", name: "Local", createdAt: NOW.toISOString(), lastUsedAt: null },
    ]);
  });

  test("returns unauthorized without a principal", async () => {
    const { service } = build({ authMode: "none" });
    const result = await service.list(headersFor("none"));
    expect(result).toBeInstanceOf(ApiTokensServiceError);
  });
});

describe("api-tokens service > revoke", () => {
  test("revokes a token", async () => {
    const { service } = build({ authMode: "session", revokeFound: true });
    const result = await service.revoke(headersFor("session"), "tok-1");
    expect(result).toEqual({ ok: true });
  });

  test("returns not-found when the token does not belong to the user", async () => {
    const { service } = build({ authMode: "session", revokeFound: false });
    const result = await service.revoke(headersFor("session"), "missing");
    expect(result).toBeInstanceOf(ApiTokensServiceError);
    expect((result as ApiTokensServiceError).code).toBe("NOT_FOUND");
  });

  test("returns unauthorized without a principal", async () => {
    const { service } = build({ authMode: "none" });
    const result = await service.revoke(headersFor("none"), "tok-1");
    expect(result).toBeInstanceOf(ApiTokensServiceError);
  });
});
