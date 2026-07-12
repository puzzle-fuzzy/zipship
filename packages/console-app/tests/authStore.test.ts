import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockApi, type MockApi } from "./helpers/mockApi";
import { getAccessToken, setAccessToken } from "../src/api/client";

/**
 * The auth store drives login / register / logout / initSession / updateProfile.
 * It depends on the Eden treaty client (`getApi()`) and the token helpers in
 * `api/client`. We mock only `getApi` (via the shared `createMockApi` treaty
 * proxy) and let the real token helpers run against jsdom `sessionStorage`, so
 * the token round-trip is exercised too.
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

// Import the store AFTER vi.mock so it picks up the overridden getApi.
const { useAuthStore } = await import("../src/stores/authStore");

let api: MockApi;

beforeEach(() => {
  api = createMockApi();
  setMockApi(api._api);
  sessionStorage.clear();
  useAuthStore.setState({ status: "loading", user: null, refreshToken: null });
});

describe("authStore > login", () => {
  it("authenticates and persists the refresh token on success", async () => {
    api.verb("post").mockResolvedValueOnce({
      data: {
        user: { id: "u1", name: "Ada", email: "ada@example.com" },
        session: { refreshToken: "rt-123" },
      },
    });

    await useAuthStore.getState().login("ada@example.com", "pw12345678", "web");

    const state = useAuthStore.getState();
    expect(state.status).toBe("authenticated");
    expect(state.user).toEqual({ id: "u1", name: "Ada", email: "ada@example.com" });
    expect(state.refreshToken).toBe("rt-123");
    expect(getAccessToken()).toBe("rt-123");
    // login payload forwarded with clientType
    expect(api.verb("post").mock.calls[0][0]).toEqual({
      email: "ada@example.com",
      password: "pw12345678",
      clientType: "web",
    });
  });

  it("throws INVALID_CREDENTIALS message on a 401 with that code", async () => {
    api.verb("post").mockResolvedValueOnce({ error: { value: { code: "INVALID_CREDENTIALS" } } });

    await expect(
      useAuthStore.getState().login("ada@example.com", "wrong", "web"),
    ).rejects.toThrow("Invalid email or password");
    expect(useAuthStore.getState().status).not.toBe("authenticated");
  });

  it("throws the fallback on an unexpected error code", async () => {
    api.verb("post").mockResolvedValueOnce({ error: { value: { code: "SOMETHING_ELSE" } } });
    await expect(
      useAuthStore.getState().login("ada@example.com", "pw", "web"),
    ).rejects.toThrow("Login failed");
  });

  it("throws when the response has no data and no error", async () => {
    api.verb("post").mockResolvedValueOnce({});
    await expect(
      useAuthStore.getState().login("ada@example.com", "pw12345678", "web"),
    ).rejects.toThrow("Login failed — empty response");
  });
});

describe("authStore > register", () => {
  it("registers and authenticates in one step", async () => {
    api.verb("post").mockResolvedValueOnce({
      data: {
        user: { id: "u2", name: "Grace", email: "grace@example.com" },
        session: { refreshToken: "rt-reg" },
      },
    });

    await useAuthStore.getState().register("Grace", "grace@example.com", "pw12345678");

    const state = useAuthStore.getState();
    expect(state.status).toBe("authenticated");
    expect(state.user?.email).toBe("grace@example.com");
    expect(state.refreshToken).toBe("rt-reg");
    expect(getAccessToken()).toBe("rt-reg");
    // register always uses web clientType
    expect(api.verb("post").mock.calls[0][0]).toEqual({
      name: "Grace",
      email: "grace@example.com",
      password: "pw12345678",
      clientType: "web",
    });
  });

  it("throws DUPLICATE_EMAIL message when the email is taken", async () => {
    api.verb("post").mockResolvedValueOnce({ error: { value: { code: "DUPLICATE_EMAIL" } } });
    await expect(
      useAuthStore.getState().register("Ada", "ada@example.com", "pw12345678"),
    ).rejects.toThrow("An account with this email already exists");
  });

  it("throws the fallback for an unknown error", async () => {
    api.verb("post").mockResolvedValueOnce({ error: {} });
    await expect(
      useAuthStore.getState().register("Ada", "ada@example.com", "pw12345678"),
    ).rejects.toThrow("Registration failed");
  });
});

describe("authStore > logout", () => {
  it("clears the session and returns to login", async () => {
    api.verb("post").mockResolvedValueOnce({
      data: {
        user: { id: "u1", name: "Ada", email: "ada@example.com" },
        session: { refreshToken: "rt-1" },
      },
    });
    await useAuthStore.getState().login("ada@example.com", "pw12345678", "web");
    expect(getAccessToken()).toBe("rt-1");

    useAuthStore.getState().logout();

    const state = useAuthStore.getState();
    expect(state.status).toBe("login");
    expect(state.user).toBeNull();
    expect(state.refreshToken).toBeNull();
    expect(getAccessToken()).toBeNull();
  });
});

describe("authStore > initSession", () => {
  it("moves to login when no token is stored", async () => {
    await useAuthStore.getState().initSession();
    expect(useAuthStore.getState().status).toBe("login");
    // no API call is made without a token
    expect(api.verb("get").mock.calls).toHaveLength(0);
  });

  it("restores the session from a stored token", async () => {
    setAccessToken("rt-saved");
    api.verb("get").mockResolvedValueOnce({
      data: { user: { id: "u1", name: "Ada", email: "ada@example.com" } },
    });

    await useAuthStore.getState().initSession();

    const state = useAuthStore.getState();
    expect(state.status).toBe("authenticated");
    expect(state.user?.email).toBe("ada@example.com");
    expect(state.refreshToken).toBe("rt-saved");
    // Authorization header forwarded from the stored token
    expect(api.verb("get").mock.calls[0][0]).toEqual({
      headers: { authorization: "Bearer rt-saved" },
    });
  });

  it("clears the token and moves to login when the token is rejected", async () => {
    setAccessToken("rt-stale");
    api.verb("get").mockResolvedValueOnce({}); // no data → treat as logged out

    await useAuthStore.getState().initSession();

    expect(useAuthStore.getState().status).toBe("login");
    expect(getAccessToken()).toBeNull();
  });

  it("survives a network error (clears and moves to login)", async () => {
    setAccessToken("rt-1");
    api.verb("get").mockRejectedValueOnce(new Error("network down"));

    await useAuthStore.getState().initSession();

    expect(useAuthStore.getState().status).toBe("login");
    expect(getAccessToken()).toBeNull();
  });
});

describe("authStore > updateProfile", () => {
  it("throws when not authenticated", async () => {
    await expect(useAuthStore.getState().updateProfile("New Name")).rejects.toThrow(
      "Not authenticated",
    );
  });

  it("updates the user's name on success", async () => {
    setAccessToken("rt-1");
    useAuthStore.setState({
      status: "authenticated",
      user: { id: "u1", name: "Old", email: "ada@example.com" },
      refreshToken: "rt-1",
    });
    api.verb("patch").mockResolvedValueOnce({
      data: { user: { id: "u1", name: "New", email: "ada@example.com" } },
    });

    await useAuthStore.getState().updateProfile("New");

    expect(useAuthStore.getState().user?.name).toBe("New");
    expect(api.verb("patch").mock.calls[0][0]).toEqual({ name: "New" });
  });

  it("throws on a patch error", async () => {
    setAccessToken("rt-1");
    api.verb("patch").mockResolvedValueOnce({ error: { value: { code: "X" } } });
    await expect(useAuthStore.getState().updateProfile("New")).rejects.toThrow(
      "Failed to update profile",
    );
  });
});
