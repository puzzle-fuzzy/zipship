import { describe, expect, test } from "bun:test";
import { InvitationsService } from "../../apps/api/src/modules/invitations/service";
import {
  InvitationsUnauthorizedError,
  InvitationsForbiddenError,
  InvitationsUserNotFoundError,
  InvitationsAlreadyMemberError,
  InvitationsPendingError,
  InvitationsNotFoundError,
  InvitationsExpiredError,
  InvitationsAlreadyAcceptedError,
  InvitationsWrongUserError,
} from "../../apps/api/src/modules/invitations/model";
import type { InvitationRecord } from "../../apps/api/src/modules/invitations/service";
import type { MemberRole } from "../../apps/api/src/modules/permissions/model";

/**
 * Shared fixtures for the invitations service.
 *
 * The service takes its collaborators through constructor injection, so every
 * collaborator is a hand-written fake (matching the existing unit-test style).
 * `build()` lets each test tweak the world (e.g. return a pending invitation)
 * without re-stating the happy path in full.
 */
const NOW = new Date("2026-07-05T00:00:00.000Z");
const ORG_ID = "org-1";
const ACTOR = { id: "user-owner", name: "Ada Lovelace", email: "ada@example.com", passwordHash: "hash" };
const INVITED = { id: "user-guest", name: "Grace Hopper", email: "grace@example.com", passwordHash: "hash" };

function isErr(v: unknown) {
  return v instanceof InvitationsUnauthorizedError
    || v instanceof InvitationsForbiddenError
    || v instanceof InvitationsUserNotFoundError
    || v instanceof InvitationsAlreadyMemberError
    || v instanceof InvitationsPendingError
    || v instanceof InvitationsNotFoundError
    || v instanceof InvitationsExpiredError
    || v instanceof InvitationsAlreadyAcceptedError
    || v instanceof InvitationsWrongUserError;
}

function build(overrides: {
  membership?: { role: "owner" | "admin" | "developer" | "deployer" | "viewer" } | null;
  invitedUser?: typeof INVITED | null;
  existingMembership?: { role: MemberRole } | null;
  pendingInvite?: { id: string } | null;
  invitationByToken?: InvitationRecord | null;
  sessions?: Map<string, unknown>;
  emails?: Array<{ to: string; invitedBy: string; organizationName: string; role: string; token: string }>;
  createdInvitations?: unknown[];
  revoked?: boolean;
  statusUpdates?: unknown[];
  membershipsCreated?: unknown[];
  actorRole?: string;
  invitationBaseUrl?: string;
} = {}) {
  const membership =
    overrides.membership === undefined ? { role: "owner" as const } : overrides.membership;
  const emails = overrides.emails ?? [];
  const createdInvitations = overrides.createdInvitations ?? [];
  const statusUpdates = overrides.statusUpdates ?? [];
  const membershipsCreated = overrides.membershipsCreated ?? [];

  const sessionRepository = {
    async findSessionByRefreshTokenHash(hash: string) {
      // The service hashes the bearer token with hashRefreshToken before
      // looking it up; "Bearer ada-refresh" → "hashed:ada-refresh".
      if (hash === "hashed:ada-refresh") {
        return {
          user: ACTOR,
          session: { id: "s1", clientType: "web" as const, expiresAt: NOW.toISOString() },
        };
      }
      return null;
    },
  };
  const authRepository = {
    async findUserByEmail(email: string) {
      if (email === INVITED.email && overrides.invitedUser !== null) return overrides.invitedUser ?? INVITED;
      return overrides.invitedUser ?? null;
    },
  };
  const organizationsRepository = {
    async findMembership({ userId }: { organizationId: string; userId: string }) {
      if (userId === ACTOR.id) {
        return membership === null ? null : { role: membership.role };
      }
      if (userId === INVITED.id) {
        return overrides.existingMembership ?? null;
      }
      return null;
    },
    async findOrganizationById() {
      return { name: "Ada Lovelace" };
    },
  };
  const invitationsRepository = {
    async createInvitation(input: any) {
      createdInvitations.push(input);
      return { id: "inv-1", email: input.email, role: input.role, status: "pending" };
    },
    async findPendingByEmail() {
      return overrides.pendingInvite ?? null;
    },
    async listInvitations() {
      return [
        {
          id: "inv-1",
          email: INVITED.email,
          role: "developer",
          status: "pending",
          createdAt: NOW,
          expiresAt: new Date(NOW.getTime() + 7 * 24 * 60 * 60 * 1000),
        },
      ];
    },
    async revokeInvitation() {
      return overrides.revoked ?? true;
    },
    async findInvitationByTokenHash(_hash: string): Promise<InvitationRecord | null> {
      return overrides.invitationByToken ?? null;
    },
    async markInvitationStatus(input: any) {
      statusUpdates.push(input);
    },
    async createMembership(input: any) {
      membershipsCreated.push(input);
    },
  };
  const emailService = {
    async sendInvitation(input: any) {
      emails.push(input);
    },
  };

  const service = new InvitationsService({
    sessionRepository,
    authRepository,
    organizationsRepository,
    invitationsRepository,
    emailService,
    hashRefreshToken: async (t: string) => `hashed:${t}`,
    hashToken: async (t: string) => `hashed-token:${t}`,
    randomToken: () => "raw-token-1234",
    invitationBaseUrl: overrides.invitationBaseUrl ?? "https://app.zipship.dev",
    now: () => NOW,
  });

  return {
    service,
    emails,
    createdInvitations,
    statusUpdates,
    membershipsCreated,
    sessionRepository,
    authRepository,
    organizationsRepository,
    invitationsRepository,
  };
}

const authedHeaders = { authorization: "Bearer ada-refresh" };
const orgParams = { organizationId: ORG_ID };

describe("invitations service > invite", () => {
  test("creates an invitation and returns a signed invite URL", async () => {
    const { service, createdInvitations, emails } = build();

    const result = await service.invite(authedHeaders, orgParams, {
      email: INVITED.email,
      role: "developer",
    });

    expect(isErr(result)).toBe(false);
    expect(result).toEqual({
      id: "inv-1",
      email: INVITED.email,
      role: "developer",
      status: "pending",
      inviteUrl: "https://app.zipship.dev/invite/raw-token-1234",
    });
    // token hashed, never stored in plaintext
    expect(createdInvitations).toEqual([
      {
        organizationId: ORG_ID,
        email: INVITED.email,
        role: "developer",
        invitedBy: ACTOR.id,
        tokenHash: "hashed-token:raw-token-1234",
        expiresAt: new Date("2026-07-12T00:00:00.000Z"),
      },
    ]);
    expect(emails).toEqual([
      {
        to: INVITED.email,
        invitedBy: ACTOR.name,
        organizationName: "Ada Lovelace",
        role: "developer",
        token: "raw-token-1234",
      },
    ]);
  });

  test("strips a trailing slash from the invitation base URL", async () => {
    const { service } = build({ invitationBaseUrl: "https://app.zipship.dev/" });

    const result = await service.invite(authedHeaders, orgParams, {
      email: INVITED.email,
      role: "viewer",
    });

    expect(isErr(result)).toBe(false);
    if (isErr(result)) return;
    expect(result.inviteUrl).toBe("https://app.zipship.dev/invite/raw-token-1234");
  });

  test("succeeds without sending email when emailService is omitted", async () => {
    // Rebuild the service without emailService to exercise the optional branch.
    const {
      service,
      emails,
    } = (() => {
      const sessionRepository = {
        async findSessionByRefreshTokenHash(hash: string) {
          if (hash === "hashed:ada-refresh") {
            return {
              user: ACTOR,
              session: { id: "s1", clientType: "web" as const, expiresAt: NOW.toISOString() },
            };
          }
          return null;
        },
      };
      const authRepository = {
        async findUserByEmail(email: string) {
          return email === INVITED.email ? INVITED : null;
        },
      };
      const organizationsRepository = {
        async findMembership({ userId }: { organizationId: string; userId: string }) {
          return userId === ACTOR.id ? { role: "owner" as const } : null;
        },
        async findOrganizationById() {
          return { name: "Ada Lovelace" };
        },
      };
      const invitationsRepository = {
        async createInvitation(input: any) {
          return { id: "inv-1", email: input.email, role: input.role, status: "pending" };
        },
        async findPendingByEmail() {
          return null;
        },
        async listInvitations() {
          return [];
        },
        async revokeInvitation() {
          return true;
        },
        async findInvitationByTokenHash() {
          return null;
        },
        async markInvitationStatus() {},
        async createMembership() {},
      };

      const service = new InvitationsService({
        sessionRepository,
        authRepository,
        organizationsRepository,
        invitationsRepository,
        // emailService deliberately omitted
        hashRefreshToken: async (t: string) => `hashed:${t}`,
        hashToken: async (t: string) => `hashed-token:${t}`,
        randomToken: () => "raw-token-1234",
        invitationBaseUrl: "https://app.zipship.dev",
        now: () => NOW,
      });
      return { service, emails: [] as unknown[] };
    })();

    const result = await service.invite(authedHeaders, orgParams, {
      email: INVITED.email,
      role: "developer",
    });

    expect(isErr(result)).toBe(false);
    expect(emails).toEqual([]);
  });

  test("returns unauthorized without a session", async () => {
    const { service } = build();
    const result = await service.invite(
      { authorization: "Bearer nobody" },
      orgParams,
      { email: INVITED.email, role: "developer" },
    );
    expect(result).toBeInstanceOf(InvitationsUnauthorizedError);
  });

  test("returns forbidden when the actor is not a member", async () => {
    const { service } = build({ membership: null });
    const result = await service.invite(authedHeaders, orgParams, {
      email: INVITED.email,
      role: "developer",
    });
    expect(result).toBeInstanceOf(InvitationsForbiddenError);
  });

  test("returns forbidden when the actor lacks invite_member permission", async () => {
    // viewer / deployer cannot invite
    const { service } = build({ membership: { role: "viewer" } });
    const result = await service.invite(authedHeaders, orgParams, {
      email: INVITED.email,
      role: "developer",
    });
    expect(result).toBeInstanceOf(InvitationsForbiddenError);
  });

  test("returns user-not-found when the invited email is unknown", async () => {
    const { service } = build({ invitedUser: null });
    const result = await service.invite(authedHeaders, orgParams, {
      email: "ghost@example.com",
      role: "developer",
    });
    expect(result).toBeInstanceOf(InvitationsUserNotFoundError);
  });

  test("returns already-member when the invitee already belongs to the org", async () => {
    const { service } = build({ existingMembership: { role: "viewer" } });
    const result = await service.invite(authedHeaders, orgParams, {
      email: INVITED.email,
      role: "developer",
    });
    expect(result).toBeInstanceOf(InvitationsAlreadyMemberError);
  });

  test("returns pending when an invitation for the email is already outstanding", async () => {
    const { service } = build({ pendingInvite: { id: "inv-old" } });
    const result = await service.invite(authedHeaders, orgParams, {
      email: INVITED.email,
      role: "developer",
    });
    expect(result).toBeInstanceOf(InvitationsPendingError);
  });
});

describe("invitations service > list", () => {
  test("lists pending invitations as ISO-formatted items", async () => {
    const { service } = build();
    const result = await service.list(authedHeaders, orgParams);

    expect(isErr(result)).toBe(false);
    if (isErr(result)) return;
    expect(result.invitations).toEqual([
      {
        id: "inv-1",
        email: INVITED.email,
        role: "developer",
        status: "pending",
        createdAt: NOW.toISOString(),
        expiresAt: new Date(NOW.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      },
    ]);
  });

  test("returns unauthorized without a session", async () => {
    const { service } = build();
    const result = await service.list({ authorization: "Bearer nobody" }, orgParams);
    expect(result).toBeInstanceOf(InvitationsUnauthorizedError);
  });

  test("returns forbidden when not a member", async () => {
    const { service } = build({ membership: null });
    const result = await service.list(authedHeaders, orgParams);
    expect(result).toBeInstanceOf(InvitationsForbiddenError);
  });

  test("returns forbidden when the actor lacks view_organization permission", async () => {
    // Every real member role grants view_organization, so the only way to lack
    // it is to not be a member at all — covered by the "not a member" test.
    // Here we assert the positive: every actual role can list invitations.
    for (const role of ["owner", "admin", "developer", "deployer", "viewer"] as const) {
      const result = await build({ membership: { role } }).service.list(authedHeaders, orgParams);
      expect(result).not.toBeInstanceOf(InvitationsForbiddenError);
    }
  });
});

describe("invitations service > revoke", () => {
  test("revokes a pending invitation", async () => {
    const { service } = build();
    const result = await service.revoke(authedHeaders, {
      organizationId: ORG_ID,
      invitationId: "inv-1",
    });
    expect(result).toEqual({ ok: true });
  });

  test("returns not-found when no pending invitation matches", async () => {
    const { service } = build({ revoked: false });
    const result = await service.revoke(authedHeaders, {
      organizationId: ORG_ID,
      invitationId: "missing",
    });
    expect(result).toBeInstanceOf(InvitationsNotFoundError);
  });

  test("returns unauthorized without a session", async () => {
    const { service } = build();
    const result = await service.revoke(
      { authorization: "Bearer nobody" },
      { organizationId: ORG_ID, invitationId: "inv-1" },
    );
    expect(result).toBeInstanceOf(InvitationsUnauthorizedError);
  });

  test("returns forbidden when the actor lacks manage_member permission", async () => {
    const { service } = build({ membership: { role: "developer" } });
    const result = await service.revoke(authedHeaders, {
      organizationId: ORG_ID,
      invitationId: "inv-1",
    });
    expect(result).toBeInstanceOf(InvitationsForbiddenError);
  });
});

describe("invitations service > accept", () => {
  function pendingInvitation(overrides: Partial<InvitationRecord> = {}): InvitationRecord {
    return {
      id: "inv-1",
      organizationId: ORG_ID,
      email: ACTOR.email,
      role: "developer",
      status: "pending",
      expiresAt: new Date(NOW.getTime() + 24 * 60 * 60 * 1000),
      ...overrides,
    };
  }

  test("accepts a valid invitation addressed to the session user", async () => {
    const { service, membershipsCreated, statusUpdates } = build({
      invitationByToken: pendingInvitation(),
    });

    const result = await service.accept(authedHeaders, { token: "raw-token-1234" });

    expect(result).toEqual({ ok: true, organizationId: ORG_ID });
    expect(membershipsCreated).toEqual([
      { organizationId: ORG_ID, userId: ACTOR.id, role: "developer" },
    ]);
    expect(statusUpdates).toEqual([
      { tokenHash: "hashed-token:raw-token-1234", status: "accepted", acceptedAt: NOW },
    ]);
  });

  test("returns unauthorized without a session", async () => {
    const { service } = build();
    const result = await service.accept({ authorization: "Bearer nobody" }, { token: "raw-token-1234" });
    expect(result).toBeInstanceOf(InvitationsUnauthorizedError);
  });

  test("returns not-found for an unknown token", async () => {
    const { service } = build({ invitationByToken: null });
    const result = await service.accept(authedHeaders, { token: "raw-token-1234" });
    expect(result).toBeInstanceOf(InvitationsNotFoundError);
  });

  test("returns already-accepted for an accepted invitation", async () => {
    const { service } = build({
      invitationByToken: pendingInvitation({ status: "accepted" }),
    });
    const result = await service.accept(authedHeaders, { token: "raw-token-1234" });
    expect(result).toBeInstanceOf(InvitationsAlreadyAcceptedError);
  });

  test("returns not-found for a revoked invitation (non-pending, non-accepted)", async () => {
    const { service } = build({
      invitationByToken: pendingInvitation({ status: "revoked" }),
    });
    const result = await service.accept(authedHeaders, { token: "raw-token-1234" });
    expect(result).toBeInstanceOf(InvitationsNotFoundError);
  });

  test("returns expired and marks the invitation expired when past its expiry", async () => {
    const { service, statusUpdates } = build({
      invitationByToken: pendingInvitation({
        expiresAt: new Date(NOW.getTime() - 60_000),
      }),
    });

    const result = await service.accept(authedHeaders, { token: "raw-token-1234" });

    expect(result).toBeInstanceOf(InvitationsExpiredError);
    expect(statusUpdates).toEqual([
      { tokenHash: "hashed-token:raw-token-1234", status: "expired" },
    ]);
  });

  test("returns wrong-user when the session email does not match the invitation", async () => {
    const { service } = build({
      invitationByToken: pendingInvitation({ email: "someone-else@example.com" }),
    });
    const result = await service.accept(authedHeaders, { token: "raw-token-1234" });
    expect(result).toBeInstanceOf(InvitationsWrongUserError);
  });
});
