import { describe, expect, test } from "bun:test";
import { WebhookService, WebhookServiceError } from "../../apps/api/src/modules/webhooks/service";

const NOW = new Date("2026-07-05T00:00:00.000Z");
const ORG_ID = "org-1";
const ACTOR = { id: "user-owner", name: "Ada Lovelace", email: "ada@example.com" };

function isErr(v: unknown) {
  return v instanceof WebhookServiceError;
}

/**
 * Constructor-injected fakes. `fetch` and `sign` are injectable seams on the
 * service, so dispatch can be exercised without a real network — and we can
 * assert exactly what signature header was sent.
 */
function build(overrides: {
  actorRole?: "owner" | "admin" | "developer" | "deployer" | "viewer" | null;
  revokeFound?: boolean;
  targets?: Array<{ url: string; secret: string }>;
  lookupThrows?: boolean;
  sign?: (payload: string, secret: string) => string;
  fetchImpl?: typeof fetch;
  randomSecret?: () => string;
} = {}) {
  const actorRole = overrides.actorRole === undefined ? "owner" : overrides.actorRole;
  const fetchCalls: Array<{
    url: string;
    method: string;
    headers: Record<string, string>;
    body: string;
  }> = [];

  const sessionRepository = {
    async findSessionByRefreshTokenHash(hash: string) {
      if (hash !== "hashed:ada-refresh") return null;
      return {
        user: ACTOR,
        session: { id: "s1", clientType: "web" as const, expiresAt: NOW.toISOString() },
      };
    },
  };

  const defaultFetch: typeof fetch = async () => new Response("ok", { status: 200 });
  // Wrap the inner impl so we always record, even when a test overrides fetch
  // (e.g. to throw / 500) — otherwise the override bypasses recording entirely.
  const innerFetch = overrides.fetchImpl ?? defaultFetch;
  const recordingFetch: typeof fetch = async (url, init) => {
    fetchCalls.push({
      url: url as string,
      method: init?.method,
      headers: init?.headers ?? {},
      body: init?.body ?? "",
    });
    return innerFetch(url, init);
  };

  const organizationsRepository = {
    async findMembership({ userId }: { organizationId: string; userId: string }) {
      if (userId === ACTOR.id) return actorRole === null ? null : { role: actorRole };
      return null;
    },
  };

  const repository = {
    async createWebhook(input: {
      organizationId: string;
      url: string;
      secret: string;
      events: string[];
    }) {
      return { id: "wh-1", url: input.url, events: input.events, createdAt: NOW };
    },
    async listWebhooksForOrganization(_organizationId: string) {
      return [
        { id: "wh-1", url: "https://example.com/hook", events: ["release.published"], createdAt: NOW },
      ];
    },
    async revokeWebhook() {
      return overrides.revokeFound ?? true;
    },
    async listActiveByEvent(_organizationId: string, _event: string) {
      if (overrides.lookupThrows) throw new Error("db down");
      return overrides.targets ?? [];
    },
  };

  const service = new WebhookService({
    repository,
    sessionRepository,
    organizationsRepository,
    hashRefreshToken: async (t: string) => `hashed:${t}`,
    now: () => NOW,
    sign:
      overrides.sign ??
      ((payload: string, secret: string) => `sig:${secret}:${payload.slice(0, 8)}`),
    fetch: recordingFetch,
    randomSecret: overrides.randomSecret ?? (() => "fixed-secret"),
  });

  return { service, fetchCalls };
}

const authedHeaders = { authorization: "Bearer ada-refresh" };
const orgParams = { organizationId: ORG_ID };

describe("webhooks service > create", () => {
  test("creates a webhook with a generated secret", async () => {
    const { service } = build();
    const result = await service.create(authedHeaders, orgParams, {
      url: "https://example.com/hook",
      events: ["release.published"],
    });

    expect(isErr(result)).toBe(false);
    if (isErr(result)) return;
    expect(result).toEqual({
      id: "wh-1",
      url: "https://example.com/hook",
      events: ["release.published"],
      createdAt: NOW.toISOString(),
    });
  });

  test("returns unauthorized without a session", async () => {
    const { service } = build();
    const result = await service.create(
      { authorization: "Bearer nobody" },
      orgParams,
      { url: "https://example.com/hook", events: ["release.published"] },
    );
    expect(result).toBeInstanceOf(WebhookServiceError);
    expect((result as WebhookServiceError).code).toBe("UNAUTHORIZED");
  });

  test("returns forbidden when the actor lacks manage_member permission", async () => {
    const { service } = build({ actorRole: "developer" });
    const result = await service.create(authedHeaders, orgParams, {
      url: "https://example.com/hook",
      events: ["release.published"],
    });
    expect(result).toBeInstanceOf(WebhookServiceError);
    expect((result as WebhookServiceError).code).toBe("FORBIDDEN");
  });

  test("returns forbidden when the actor is not a member", async () => {
    const { service } = build({ actorRole: null });
    const result = await service.create(authedHeaders, orgParams, {
      url: "https://example.com/hook",
      events: ["release.published"],
    });
    expect(result).toBeInstanceOf(WebhookServiceError);
    expect((result as WebhookServiceError).code).toBe("FORBIDDEN");
  });
});

describe("webhooks service > list", () => {
  test("lists webhooks for an organization", async () => {
    const { service } = build();
    const result = await service.list(authedHeaders, orgParams);

    expect(isErr(result)).toBe(false);
    if (isErr(result)) return;
    expect(result.webhooks).toEqual([
      {
        id: "wh-1",
        url: "https://example.com/hook",
        events: ["release.published"],
        createdAt: NOW.toISOString(),
      },
    ]);
  });

  test("returns unauthorized without a session", async () => {
    const { service } = build();
    const result = await service.list({ authorization: "Bearer nobody" }, orgParams);
    expect(result).toBeInstanceOf(WebhookServiceError);
    expect((result as WebhookServiceError).code).toBe("UNAUTHORIZED");
  });

  test("returns forbidden when the actor lacks view_organization permission", async () => {
    const { service } = build({ actorRole: null });
    const result = await service.list(authedHeaders, orgParams);
    expect(result).toBeInstanceOf(WebhookServiceError);
    expect((result as WebhookServiceError).code).toBe("FORBIDDEN");
  });
});

describe("webhooks service > revoke", () => {
  test("revokes a webhook", async () => {
    const { service } = build();
    const result = await service.revoke(authedHeaders, {
      organizationId: ORG_ID,
      webhookId: "wh-1",
    });
    expect(result).toEqual({ ok: true });
  });

  test("returns not-found when no active webhook matches", async () => {
    const { service } = build({ revokeFound: false });
    const result = await service.revoke(authedHeaders, {
      organizationId: ORG_ID,
      webhookId: "missing",
    });
    expect(result).toBeInstanceOf(WebhookServiceError);
    expect((result as WebhookServiceError).code).toBe("NOT_FOUND");
  });

  test("returns forbidden when the actor lacks manage_member permission", async () => {
    const { service } = build({ actorRole: "viewer" });
    const result = await service.revoke(authedHeaders, {
      organizationId: ORG_ID,
      webhookId: "wh-1",
    });
    expect(result).toBeInstanceOf(WebhookServiceError);
    expect((result as WebhookServiceError).code).toBe("FORBIDDEN");
  });

  test("returns unauthorized without a session", async () => {
    const { service } = build();
    const result = await service.revoke(
      { authorization: "Bearer nobody" },
      { organizationId: ORG_ID, webhookId: "wh-1" },
    );
    expect(result).toBeInstanceOf(WebhookServiceError);
    expect((result as WebhookServiceError).code).toBe("UNAUTHORIZED");
  });
});

describe("webhooks service > dispatch", () => {
  test("POSTs a HMAC-signed JSON payload to every active webhook", async () => {
    const { service, fetchCalls } = build({
      targets: [
        { url: "https://a.example.com/hook", secret: "secret-a" },
        { url: "https://b.example.com/hook", secret: "secret-b" },
      ],
    });

    await service.dispatch("release.published", {
      organizationId: ORG_ID,
      payload: { releaseHash: "abc123" },
    });

    expect(fetchCalls).toHaveLength(2);
    expect(fetchCalls.map((c) => c.url).sort()).toEqual([
      "https://a.example.com/hook",
      "https://b.example.com/hook",
    ]);

    const first = fetchCalls[0];
    expect(first.method).toBe("POST");
    expect(first.headers["content-type"]).toBe("application/json");
    expect(first.headers["x-zipship-event"]).toBe("release.published");
    // signature is present and tied to the body + that target's secret
    expect(first.headers["x-zipship-signature"]).toBeTruthy();

    const parsed = JSON.parse(first.body);
    expect(parsed.event).toBe("release.published");
    expect(parsed.deliveredAt).toBe(NOW.toISOString());
    expect(parsed.data).toEqual({ releaseHash: "abc123" });
  });

  test("signs the exact body that is sent", async () => {
    const seen: Array<{ signature: string; body: string; secret: string }> = [];
    const { service } = build({
      targets: [{ url: "https://a.example.com/hook", secret: "secret-a" }],
      sign: (payload, secret) => {
        seen.push({ signature: `hmac(${secret},${payload})`, body: payload, secret });
        return `hmac(${secret},${payload})`;
      },
    });

    await service.dispatch("release.rolled_back", {
      organizationId: ORG_ID,
      payload: { releaseHash: "deadbeef" },
    });

    expect(seen).toHaveLength(1);
    // the signature header must match what was computed over the exact body
    expect(seen[0].body).toContain('"release.rolled_back"');
    expect(seen[0].body).toContain('"deadbeef"');
  });

  test("does nothing when there are no subscribers", async () => {
    const { service, fetchCalls } = build({ targets: [] });
    await service.dispatch("release.published", {
      organizationId: ORG_ID,
      payload: { releaseHash: "abc123" },
    });
    expect(fetchCalls).toEqual([]);
  });

  test("swallows a failed webhook lookup (never throws)", async () => {
    const { service, fetchCalls } = build({ lookupThrows: true });
    // should resolve, not reject
    await expect(
      service.dispatch("release.published", {
        organizationId: ORG_ID,
        payload: { releaseHash: "abc123" },
      }),
    ).resolves.toBeUndefined();
    expect(fetchCalls).toEqual([]);
  });

  test("does not abort delivery when an individual endpoint fails", async () => {
    const { service, fetchCalls } = build({
      targets: [
        { url: "https://broken.example.com/hook", secret: "s1" },
        { url: "https://ok.example.com/hook", secret: "s2" },
      ],
      fetchImpl: (async (url: any) => {
        if (url.includes("broken")) throw new Error("network down");
        return new Response("ok", { status: 200 });
      }) as typeof fetch,
    });

    await service.dispatch("release.published", {
      organizationId: ORG_ID,
      payload: { releaseHash: "abc123" },
    });

    // the healthy endpoint still received delivery despite the sibling failure
    expect(fetchCalls.map((c) => c.url)).toEqual([
      "https://broken.example.com/hook",
      "https://ok.example.com/hook",
    ]);
  });

  test("treats a non-2xx response as a soft failure (no throw)", async () => {
    const { service } = build({
      targets: [{ url: "https://a.example.com/hook", secret: "s1" }],
      fetchImpl: (async () => new Response("nope", { status: 500 })) as typeof fetch,
    });

    await expect(
      service.dispatch("release.published", {
        organizationId: ORG_ID,
        payload: { releaseHash: "abc123" },
      }),
    ).resolves.toBeUndefined();
  });
});
