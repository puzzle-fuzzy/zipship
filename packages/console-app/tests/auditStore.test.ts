import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockApi, type MockApi } from "./helpers/mockApi";
import { setAccessToken } from "../src/api/client";

/**
 * auditStore is org-scoped and previously swallowed fetch errors, leaving the
 * Activity tab stuck on "Loading...". We pin: success stores logs, empty/error
 * responses set `error`, and thrown network errors are caught.
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

const { useAuditStore } = await import("../src/stores/auditStore");

let api: MockApi;
beforeEach(() => {
  api = createMockApi();
  setMockApi(api._api);
  setAccessToken("rt-1");
  useAuditStore.setState({ logs: [], loading: false, error: null });
});

describe("auditStore > fetchAudit", () => {
  it("stores logs and clears loading/error on success", async () => {
    api.verb("get").mockResolvedValueOnce({
      data: { auditLogs: [{ id: "a1", action: "release.published" }] },
    });
    await useAuditStore.getState().fetchAudit("org-1");
    const s = useAuditStore.getState();
    expect(s.logs).toHaveLength(1);
    expect(s.loading).toBe(false);
    expect(s.error).toBeNull();
  });

  it("sets an error (not infinite loading) when the response has no data", async () => {
    api.verb("get").mockResolvedValueOnce({});
    await useAuditStore.getState().fetchAudit("org-1");
    const s = useAuditStore.getState();
    expect(s.loading).toBe(false);
    expect(s.error).toBe("Failed to load activity");
  });

  it("sets an error on a thrown network failure", async () => {
    api.verb("get").mockRejectedValueOnce(new Error("net"));
    await expect(useAuditStore.getState().fetchAudit("org-1")).resolves.toBeUndefined();
    const s = useAuditStore.getState();
    expect(s.loading).toBe(false);
    expect(s.error).toBe("Failed to load activity");
  });

  it("clears a previous error on a successful reload", async () => {
    useAuditStore.setState({ error: "Failed to load activity" });
    api.verb("get").mockResolvedValueOnce({ data: { auditLogs: [] } });
    await useAuditStore.getState().fetchAudit("org-1");
    expect(useAuditStore.getState().error).toBeNull();
    expect(useAuditStore.getState().loading).toBe(false);
  });
});
