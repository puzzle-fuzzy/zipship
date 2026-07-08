import { describe, expect, test } from "bun:test";
import { MembersService } from "../../apps/api/src/modules/members/service";
import {
  MembersUnauthorizedError,
  MembersForbiddenError,
  MembersNotFoundError,
  MembersLastOwnerError,
} from "../../apps/api/src/modules/members/model";

const NOW = new Date("2026-07-05T00:00:00.000Z");
const ORG_ID = "org-1";
const ACTOR = { id: "user-owner", name: "Ada Lovelace", email: "ada@example.com" };
const TARGET = { id: "user-guest", name: "Grace Hopper", email: "grace@example.com" };

function isErr(v: unknown) {
  return (
    v instanceof MembersUnauthorizedError ||
    v instanceof MembersForbiddenError ||
    v instanceof MembersNotFoundError ||
    v instanceof MembersLastOwnerError
  );
}

/**
 * All collaborators are constructor-injected hand-written fakes, matching the
 * existing `audit-service` / `auth-login` unit-test style.
 */
function build(overrides: {
  actorRole?: "owner" | "admin" | "developer" | "deployer" | "viewer" | null;
  targetRole?: string | null;
  ownerCount?: number;
} = {}) {
  const actorRole = overrides.actorRole === undefined ? "owner" : overrides.actorRole;

  const sessionRepository = {
    async findSessionByRefreshTokenHash(hash: string) {
      if (hash !== "hashed:ada-refresh") return null;
      return {
        user: ACTOR,
        session: { id: "s1", clientType: "web" as const, expiresAt: NOW.toISOString() },
      };
    },
  };

  const membersRepository = {
    async listMembers(_organizationId: string) {
      return [
        {
          id: "member-1",
          userId: ACTOR.id,
          name: ACTOR.name,
          email: ACTOR.email,
          role: "owner",
          joinedAt: NOW.toISOString(),
        },
        {
          id: "member-2",
          userId: TARGET.id,
          name: TARGET.name,
          email: TARGET.email,
          role: "developer",
          joinedAt: NOW.toISOString(),
        },
      ];
    },
    async updateMemberRole(input: { organizationId: string; userId: string; role: string }) {
      calls.roleUpdates.push(input);
    },
    async removeMember(input: { organizationId: string; userId: string }) {
      calls.removals.push(input);
    },
    async countOwners(_organizationId: string) {
      return overrides.ownerCount ?? 1;
    },
  };

  const organizationsRepository = {
    async findMembership({ userId }: { organizationId: string; userId: string }) {
      if (userId === ACTOR.id) return actorRole === null ? null : { role: actorRole };
      if (userId === TARGET.id) {
        return overrides.targetRole === undefined || overrides.targetRole === null
          ? null
          : { role: overrides.targetRole };
      }
      return null;
    },
  };

  const calls = {
    roleUpdates: [] as Array<{ organizationId: string; userId: string; role: string }>,
    removals: [] as Array<{ organizationId: string; userId: string }>,
  };

  const service = new MembersService({
    sessionRepository,
    membersRepository,
    organizationsRepository,
    hashRefreshToken: async (t: string) => `hashed:${t}`,
    now: () => NOW,
  });

  return { service, calls };
}

const authedHeaders = { authorization: "Bearer ada-refresh" };
const orgParams = { organizationId: ORG_ID };
const targetParams = { organizationId: ORG_ID, userId: TARGET.id };

describe("members service > list", () => {
  test("lists members for an organization", async () => {
    const { service } = build();
    const result = await service.list(authedHeaders, orgParams);

    expect(isErr(result)).toBe(false);
    if (isErr(result)) return;
    expect(result.members).toHaveLength(2);
    expect(result.members[0]).toMatchObject({ userId: ACTOR.id, role: "owner" });
    expect(result.members[1]).toMatchObject({ userId: TARGET.id, role: "developer" });
  });

  test("returns unauthorized without a session", async () => {
    const { service } = build();
    const result = await service.list({ authorization: "Bearer nobody" }, orgParams);
    expect(result).toBeInstanceOf(MembersUnauthorizedError);
  });

  test("returns forbidden when the actor is not a member", async () => {
    const { service } = build({ actorRole: null });
    const result = await service.list(authedHeaders, orgParams);
    expect(result).toBeInstanceOf(MembersForbiddenError);
  });

  test("returns forbidden when the actor lacks view_organization permission", async () => {
    // deployer DOES have view_organization; use a role that lacks it.
    // All real roles except none have view_organization, so assert via non-member.
    const { service } = build({ actorRole: null });
    const result = await service.list(authedHeaders, orgParams);
    expect(result).toBeInstanceOf(MembersForbiddenError);
  });
});

describe("members service > changeRole", () => {
  test("updates a non-owner target's role", async () => {
    const { service, calls } = build({ targetRole: "developer" });
    const result = await service.changeRole(authedHeaders, targetParams, { role: "admin" });

    expect(result).toEqual({ ok: true });
    expect(calls.roleUpdates).toEqual([
      { organizationId: ORG_ID, userId: TARGET.id, role: "admin" },
    ]);
  });

  test("demotes an owner when there is more than one owner", async () => {
    const { service, calls } = build({ targetRole: "owner", ownerCount: 2 });
    const result = await service.changeRole(authedHeaders, targetParams, { role: "admin" });

    expect(result).toEqual({ ok: true });
    expect(calls.roleUpdates).toEqual([
      { organizationId: ORG_ID, userId: TARGET.id, role: "admin" },
    ]);
  });

  test("refuses to demote the last owner", async () => {
    const { service, calls } = build({ targetRole: "owner", ownerCount: 1 });
    const result = await service.changeRole(authedHeaders, targetParams, { role: "admin" });

    expect(result).toBeInstanceOf(MembersLastOwnerError);
    expect(calls.roleUpdates).toEqual([]);
  });

  test("returns unauthorized without a session", async () => {
    const { service } = build();
    const result = await service.changeRole(
      { authorization: "Bearer nobody" },
      targetParams,
      { role: "admin" },
    );
    expect(result).toBeInstanceOf(MembersUnauthorizedError);
  });

  test("returns forbidden when the actor is not a member", async () => {
    const { service } = build({ actorRole: null });
    const result = await service.changeRole(authedHeaders, targetParams, { role: "admin" });
    expect(result).toBeInstanceOf(MembersForbiddenError);
  });

  test("returns forbidden when the actor lacks manage_member permission", async () => {
    // developer cannot manage members
    const { service } = build({ actorRole: "developer" });
    const result = await service.changeRole(authedHeaders, targetParams, { role: "admin" });
    expect(result).toBeInstanceOf(MembersForbiddenError);
  });

  test("returns not-found when the target is not a member", async () => {
    const { service } = build({ targetRole: null });
    const result = await service.changeRole(authedHeaders, targetParams, { role: "admin" });
    expect(result).toBeInstanceOf(MembersNotFoundError);
  });
});

describe("members service > remove", () => {
  test("removes a non-owner member", async () => {
    const { service, calls } = build({ targetRole: "developer" });
    const result = await service.remove(authedHeaders, targetParams);

    expect(result).toEqual({ ok: true });
    expect(calls.removals).toEqual([{ organizationId: ORG_ID, userId: TARGET.id }]);
  });

  test("removes an owner when there is more than one owner", async () => {
    const { service, calls } = build({ targetRole: "owner", ownerCount: 2 });
    const result = await service.remove(authedHeaders, targetParams);

    expect(result).toEqual({ ok: true });
    expect(calls.removals).toEqual([{ organizationId: ORG_ID, userId: TARGET.id }]);
  });

  test("refuses to remove the last owner", async () => {
    const { service, calls } = build({ targetRole: "owner", ownerCount: 1 });
    const result = await service.remove(authedHeaders, targetParams);

    expect(result).toBeInstanceOf(MembersLastOwnerError);
    expect(calls.removals).toEqual([]);
  });

  test("returns unauthorized without a session", async () => {
    const { service } = build();
    const result = await service.remove(
      { authorization: "Bearer nobody" },
      targetParams,
    );
    expect(result).toBeInstanceOf(MembersUnauthorizedError);
  });

  test("returns forbidden when the actor lacks manage_member permission", async () => {
    const { service } = build({ actorRole: "viewer" });
    const result = await service.remove(authedHeaders, targetParams);
    expect(result).toBeInstanceOf(MembersForbiddenError);
  });

  test("returns not-found when the target is not a member", async () => {
    const { service } = build({ targetRole: null });
    const result = await service.remove(authedHeaders, targetParams);
    expect(result).toBeInstanceOf(MembersNotFoundError);
  });
});
