import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockApi, type MockApi } from "./helpers/mockApi";
import { setAccessToken } from "../src/api/client";

/**
 * membersStore covers fetchMembers (org-scoped list) and inviteMember. Only
 * `getApi()` is mocked; real token helpers run against jsdom storage.
 */

const { mockApi, setMockApi } = vi.hoisted(() => {
  let current: unknown = null;
  return {
    mockApi: () => current,
    setMockApi: (a: unknown) => {
      current = a;
    },
  };
});

vi.mock("../src/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/api/client")>();
  return { ...actual, getApi: () => mockApi() };
});

const { useMembersStore } = await import("../src/stores/membersStore");

let api: MockApi;
beforeEach(() => {
  api = createMockApi();
  setMockApi(api._api);
  setAccessToken("rt-1");
  useMembersStore.setState({ members: [], loading: false, error: null });
});

describe("membersStore > fetchMembers", () => {
  it("loads members and clears loading/error", async () => {
    api.verb("get").mockResolvedValueOnce({
      data: {
        members: [
          { id: "m1", userId: "u1", name: "Ada", email: "a@x.com", role: "owner", joinedAt: "" },
        ],
      },
    });
    await useMembersStore.getState().fetchMembers("org-1");
    const s = useMembersStore.getState();
    expect(s.members).toHaveLength(1);
    expect(s.loading).toBe(false);
    expect(s.error).toBeNull();
  });

  it("sets an error message on a response error", async () => {
    api.verb("get").mockResolvedValueOnce({ error: { value: { code: "X" } } });
    await useMembersStore.getState().fetchMembers("org-1");
    expect(useMembersStore.getState().error).toBe("Failed to fetch members");
    expect(useMembersStore.getState().loading).toBe(false);
  });

  it("survives a thrown network error", async () => {
    api.verb("get").mockRejectedValueOnce(new Error("net"));
    await expect(useMembersStore.getState().fetchMembers("org-1")).resolves.toBeUndefined();
    expect(useMembersStore.getState().error).toBe("Failed to fetch members");
  });
});

describe("membersStore > inviteMember", () => {
  it("posts the invitation and returns the invite url", async () => {
    api.verb("post").mockResolvedValueOnce({ data: { inviteUrl: "https://x/invite/tok" } });
    const res = await useMembersStore.getState().inviteMember("org-1", "a@x.com", "developer");
    expect(res).toEqual({ inviteUrl: "https://x/invite/tok" });
    expect(api.verb("post").mock.calls[0][0]).toEqual({ email: "a@x.com", role: "developer" });
  });

  it("maps USER_NOT_FOUND to a friendly message", async () => {
    api.verb("post").mockResolvedValueOnce({ error: { value: { code: "USER_NOT_FOUND" } } });
    await expect(useMembersStore.getState().inviteMember("org-1", "x@y", "viewer")).rejects.toThrow(
      "No user found with this email",
    );
  });

  it("maps ALREADY_MEMBER", async () => {
    api.verb("post").mockResolvedValueOnce({ error: { value: { code: "ALREADY_MEMBER" } } });
    await expect(useMembersStore.getState().inviteMember("org-1", "x@y", "viewer")).rejects.toThrow(
      "This user is already a member",
    );
  });

  it("maps INVITATION_PENDING", async () => {
    api.verb("post").mockResolvedValueOnce({ error: { value: { code: "INVITATION_PENDING" } } });
    await expect(useMembersStore.getState().inviteMember("org-1", "x@y", "viewer")).rejects.toThrow(
      "An invitation is already pending for this email",
    );
  });

  it("falls back for unknown codes", async () => {
    api.verb("post").mockResolvedValueOnce({ error: { value: { code: "MYSTERY" } } });
    await expect(useMembersStore.getState().inviteMember("org-1", "x@y", "viewer")).rejects.toThrow(
      "Failed to send invitation",
    );
  });
});

describe("membersStore > updateMemberRole", () => {
  it("patches the role and updates local state", async () => {
    useMembersStore.setState({
      members: [
        { id: "m1", userId: "u1", name: "Ada", email: "a@x.com", role: "viewer", joinedAt: "" },
      ],
    });
    api.verb("patch").mockResolvedValueOnce({ data: { ok: true } });

    await useMembersStore.getState().updateMemberRole("org-1", "u1", "developer");

    expect(api.verb("patch").mock.calls[0][0]).toEqual({ role: "developer" });
    expect(useMembersStore.getState().members[0].role).toBe("developer");
  });

  it("maps LAST_OWNER when demoting the final owner", async () => {
    api.verb("patch").mockResolvedValueOnce({ error: { value: { code: "LAST_OWNER" } } });
    await expect(
      useMembersStore.getState().updateMemberRole("org-1", "u1", "admin"),
    ).rejects.toThrow("Can't remove or demote the last owner");
  });

  it("maps FORBIDDEN when the user lacks permission", async () => {
    api.verb("patch").mockResolvedValueOnce({ error: { value: { code: "FORBIDDEN" } } });
    await expect(
      useMembersStore.getState().updateMemberRole("org-1", "u1", "admin"),
    ).rejects.toThrow("You don't have permission to do that");
  });

  it("leaves local state untouched on failure", async () => {
    useMembersStore.setState({
      members: [
        { id: "m1", userId: "u1", name: "Ada", email: "a@x.com", role: "viewer", joinedAt: "" },
      ],
    });
    api.verb("patch").mockResolvedValueOnce({ error: { value: { code: "FORBIDDEN" } } });
    await expect(
      useMembersStore.getState().updateMemberRole("org-1", "u1", "admin"),
    ).rejects.toThrow();
    expect(useMembersStore.getState().members[0].role).toBe("viewer");
  });
});

describe("membersStore > removeMember", () => {
  it("deletes and removes the member from local state", async () => {
    useMembersStore.setState({
      members: [
        { id: "m1", userId: "u1", name: "Ada", email: "a@x.com", role: "viewer", joinedAt: "" },
        { id: "m2", userId: "u2", name: "Bo", email: "b@x.com", role: "developer", joinedAt: "" },
      ],
    });
    api.verb("delete").mockResolvedValueOnce({ data: { ok: true } });

    await useMembersStore.getState().removeMember("org-1", "u1");

    expect(useMembersStore.getState().members).toEqual([
      { id: "m2", userId: "u2", name: "Bo", email: "b@x.com", role: "developer", joinedAt: "" },
    ]);
  });

  it("maps LAST_OWNER when removing the final owner", async () => {
    api.verb("delete").mockResolvedValueOnce({ error: { value: { code: "LAST_OWNER" } } });
    await expect(useMembersStore.getState().removeMember("org-1", "u1")).rejects.toThrow(
      "Can't remove or demote the last owner",
    );
  });

  it("maps NOT_FOUND", async () => {
    api.verb("delete").mockResolvedValueOnce({ error: { value: { code: "NOT_FOUND" } } });
    await expect(useMembersStore.getState().removeMember("org-1", "u1")).rejects.toThrow(
      "Not found",
    );
  });
});
