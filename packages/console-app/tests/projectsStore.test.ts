import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockApi, type MockApi } from "./helpers/mockApi";
import { setAccessToken } from "../src/api/client";

/**
 * projectsStore covers fetch/create/publish/rollback/delete/update + release listing.
 * Only `getApi()` is mocked; real token helpers run against jsdom storage.
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

const { useProjectsStore } = await import("../src/stores/projectsStore");

let api: MockApi;
beforeEach(() => {
  api = createMockApi();
  setMockApi(api._api);
  setAccessToken("rt-1");
  useProjectsStore.setState({
    projects: [],
    releases: {},
    releaseErrors: {},
    deployments: {},
    deploymentErrors: {},
    loading: true,
  });
});

describe("projectsStore > fetchProjects", () => {
  it("loads org then projects in order and stores them", async () => {
    api.verb("get").mockResolvedValueOnce({ data: { organizations: [{ id: "org-1" }] } });
    api.verb("get").mockResolvedValueOnce({ data: { projects: [{ id: "p1", name: "A" }] } });

    await useProjectsStore.getState().fetchProjects();
    const s = useProjectsStore.getState();
    expect(s.projects).toEqual([{ id: "p1", name: "A" }]);
    expect(s.loading).toBe(false);
  });

  it("bails to loading:false when the user has no org", async () => {
    api.verb("get").mockResolvedValueOnce({ data: { organizations: [] } });
    await useProjectsStore.getState().fetchProjects();
    expect(useProjectsStore.getState().loading).toBe(false);
    expect(useProjectsStore.getState().projects).toEqual([]);
  });

  it("bails (no throw) on an org error", async () => {
    api.verb("get").mockResolvedValueOnce({ error: { value: { code: "UNAUTHORIZED" } } });
    await expect(useProjectsStore.getState().fetchProjects()).resolves.toBeUndefined();
    expect(useProjectsStore.getState().loading).toBe(false);
  });
});

describe("projectsStore > createProject", () => {
  it("looks up the org then posts the project (empty description → null)", async () => {
    api.verb("get").mockResolvedValueOnce({ data: { organizations: [{ id: "org-1" }] } });
    api.verb("post").mockResolvedValueOnce({ data: { id: "p1" } });

    await useProjectsStore.getState().createProject({ name: "A", slug: "a", description: "" });
    expect(api.verb("post").mock.calls[0][0]).toEqual({ name: "A", slug: "a", description: null });
  });

  it("throws DUPLICATE_PROJECT_SLUG message on conflict", async () => {
    api.verb("get").mockResolvedValueOnce({ data: { organizations: [{ id: "org-1" }] } });
    api.verb("post").mockResolvedValueOnce({ error: { value: { code: "DUPLICATE_PROJECT_SLUG" } } });
    await expect(
      useProjectsStore.getState().createProject({ name: "A", slug: "a", description: "" }),
    ).rejects.toThrow("A project with this slug already exists");
  });

  it("throws when the user has no org", async () => {
    api.verb("get").mockResolvedValueOnce({ data: { organizations: [] } });
    await expect(
      useProjectsStore.getState().createProject({ name: "A", slug: "a", description: "" }),
    ).rejects.toThrow("No organization found");
  });
});

describe("projectsStore > fetchReleases", () => {
  it("stores releases keyed by projectId", async () => {
    api.verb("get").mockResolvedValueOnce({ data: { releases: [{ id: "r1" }] } });
    await useProjectsStore.getState().fetchReleases("p1");
    expect(useProjectsStore.getState().releases["p1"]).toEqual([{ id: "r1" }]);
    expect(useProjectsStore.getState().releaseErrors["p1"]).toBeNull();
  });

  it("stores API errors keyed by projectId", async () => {
    api.verb("get").mockResolvedValueOnce({ error: { value: { code: "FORBIDDEN" } } });
    await useProjectsStore.getState().fetchReleases("p1");
    expect(useProjectsStore.getState().releaseErrors["p1"]).toBe("You don't have permission to do that");
  });

  it("swallows network errors without throwing", async () => {
    api.verb("get").mockRejectedValueOnce(new Error("boom"));
    await expect(useProjectsStore.getState().fetchReleases("p1")).resolves.toBeUndefined();
    expect(useProjectsStore.getState().releaseErrors["p1"]).toBe("Failed to load releases");
  });
});

describe("projectsStore > fetchDeployments", () => {
  it("stores deployments keyed by projectId", async () => {
    api.verb("get").mockResolvedValueOnce({ data: { deployments: [{ id: "d1", action: "publish" }] } });
    await useProjectsStore.getState().fetchDeployments("p1");
    expect(useProjectsStore.getState().deployments["p1"]).toEqual([{ id: "d1", action: "publish" }]);
    expect(useProjectsStore.getState().deploymentErrors["p1"]).toBeNull();
  });

  it("stores deployment list errors keyed by projectId", async () => {
    api.verb("get").mockResolvedValueOnce({ error: { value: { code: "FORBIDDEN" } } });
    await useProjectsStore.getState().fetchDeployments("p1");
    expect(useProjectsStore.getState().deploymentErrors["p1"]).toBe("You don't have permission to do that");
  });

  it("swallows deployment history network errors without throwing", async () => {
    api.verb("get").mockRejectedValueOnce(new Error("boom"));
    await expect(useProjectsStore.getState().fetchDeployments("p1")).resolves.toBeUndefined();
    expect(useProjectsStore.getState().deploymentErrors["p1"]).toBe("Failed to load deployment history");
  });
});

describe("projectsStore > publishRelease", () => {
  it("publishes then refreshes the release list", async () => {
    useProjectsStore.setState({
      releaseErrors: { p1: "old release error" },
      deploymentErrors: { p1: "old deployment error" },
    });
    api.verb("post").mockResolvedValueOnce({ data: {} });
    api.verb("get").mockResolvedValueOnce({ data: { releases: [{ id: "r1", status: "active" }] } });
    api.verb("get").mockResolvedValueOnce({ data: { deployments: [{ id: "d1", releaseId: "r1" }] } });
    await useProjectsStore.getState().publishRelease("p1", "r1", "Ship homepage");
    expect(api.verb("post").mock.calls[0][0]).toEqual({ message: "Ship homepage" });
    expect(useProjectsStore.getState().releases["p1"]).toEqual([{ id: "r1", status: "active" }]);
    expect(useProjectsStore.getState().deployments["p1"]).toEqual([{ id: "d1", releaseId: "r1" }]);
    expect(useProjectsStore.getState().releaseErrors["p1"]).toBeNull();
    expect(useProjectsStore.getState().deploymentErrors["p1"]).toBeNull();
  });

  it("rethrows a publish failure", async () => {
    api.verb("post").mockResolvedValueOnce({ error: { value: { code: "FORBIDDEN" } } });
    await expect(useProjectsStore.getState().publishRelease("p1", "r1")).rejects.toThrow(
      "Failed to publish release",
    );
  });
});

describe("projectsStore > rollbackRelease", () => {
  it("rolls back then refreshes the release list", async () => {
    api.verb("post").mockResolvedValueOnce({ data: {} });
    api.verb("get").mockResolvedValueOnce({ data: { releases: [{ id: "r1", status: "active" }] } });
    api.verb("get").mockResolvedValueOnce({ data: { deployments: [{ id: "d1", action: "rollback" }] } });
    await useProjectsStore.getState().rollbackRelease("p1", "r1", "Bad deploy");
    expect(api.verb("post").mock.calls[0][0]).toEqual({ message: "Bad deploy" });
    expect(useProjectsStore.getState().releases["p1"]).toEqual([{ id: "r1", status: "active" }]);
    expect(useProjectsStore.getState().deployments["p1"]).toEqual([{ id: "d1", action: "rollback" }]);
  });

  it("rethrows a rollback failure", async () => {
    api.verb("post").mockResolvedValueOnce({ error: { value: { code: "FORBIDDEN" } } });
    await expect(useProjectsStore.getState().rollbackRelease("p1", "r1")).rejects.toThrow(
      "Failed to roll back release",
    );
  });
});

describe("projectsStore > deleteProject", () => {
  it("removes the project from local state", async () => {
    useProjectsStore.setState({
      projects: [
        { id: "p1", name: "A" },
        { id: "p2", name: "B" },
      ] as never,
    });
    api.verb("delete").mockResolvedValueOnce({ data: {} });
    await useProjectsStore.getState().deleteProject("p1");
    expect(useProjectsStore.getState().projects).toEqual([{ id: "p2", name: "B" }]);
  });

  it("maps FORBIDDEN to a permission message", async () => {
    api.verb("delete").mockResolvedValueOnce({ error: { value: { code: "FORBIDDEN" } } });
    await expect(useProjectsStore.getState().deleteProject("p1")).rejects.toThrow(
      "No permission to delete this project",
    );
  });
});

describe("projectsStore > updateProject", () => {
  it("patches the project", async () => {
    api.verb("patch").mockResolvedValueOnce({ data: {} });
    await useProjectsStore.getState().updateProject("p1", { name: "New" });
    expect(api.verb("patch").mock.calls[0][0]).toEqual({ name: "New" });
  });

  it("maps DUPLICATE_PROJECT_SLUG when renaming to a conflicting slug", async () => {
    api.verb("patch").mockResolvedValueOnce({ error: { value: { code: "DUPLICATE_PROJECT_SLUG" } } });
    await expect(
      useProjectsStore.getState().updateProject("p1", { slug: "taken" }),
    ).rejects.toThrow("A project with this slug already exists");
  });

  it("maps FORBIDDEN when the user lacks permission", async () => {
    api.verb("patch").mockResolvedValueOnce({ error: { value: { code: "FORBIDDEN" } } });
    await expect(useProjectsStore.getState().updateProject("p1", { name: "x" })).rejects.toThrow(
      "You don't have permission to do that",
    );
  });

  it("falls back for unknown codes", async () => {
    api.verb("patch").mockResolvedValueOnce({ error: { value: { code: "MYSTERY" } } });
    await expect(useProjectsStore.getState().updateProject("p1", { name: "x" })).rejects.toThrow(
      "Failed to update project",
    );
  });
});
