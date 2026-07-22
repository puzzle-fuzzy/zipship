import { beforeEach, describe, expect, it, vi } from "vitest";
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

const { useOrganizationsStore } = await import("../src/stores/organizationsStore");
let api: MockApi;

const organizations = [
  {
    id: "org-1",
    name: "Acme",
    slug: "acme",
    role: "owner",
    createdAt: "2026-07-15T00:00:00Z",
  },
  {
    id: "org-2",
    name: "Orbit",
    slug: "orbit",
    role: "developer",
    createdAt: "2026-07-16T00:00:00Z",
  },
];

beforeEach(() => {
  api = createMockApi();
  setMockApi(api._api);
  localStorage.clear();
  useOrganizationsStore.setState({
    organizations: [],
    selectedOrganizationId: null,
    loading: false,
    initialized: false,
    error: null,
  });
});

describe("organizationsStore", () => {
  it("restores a persisted organization only after membership is revalidated", async () => {
    localStorage.setItem("zipship_organization_id", "org-2");
    api.verb("get").mockResolvedValueOnce({ data: { organizations } });

    await useOrganizationsStore.getState().initializeOrganizations();

    expect(api.verb("get")).toHaveBeenCalledWith("/_api/organizations");
    expect(useOrganizationsStore.getState()).toMatchObject({
      organizations,
      selectedOrganizationId: "org-2",
      initialized: true,
      loading: false,
      error: null,
    });
  });

  it("falls back to the first visible organization when the saved id is stale", async () => {
    localStorage.setItem("zipship_organization_id", "org-removed");
    api.verb("get").mockResolvedValueOnce({ data: { organizations } });

    await useOrganizationsStore.getState().initializeOrganizations();

    expect(useOrganizationsStore.getState().selectedOrganizationId).toBe("org-1");
    expect(localStorage.getItem("zipship_organization_id")).toBe("org-1");
  });

  it("persists validated switches and rejects ids outside the visible list", () => {
    useOrganizationsStore.setState({ organizations });

    expect(useOrganizationsStore.getState().selectOrganization("org-2")).toBe(true);
    expect(useOrganizationsStore.getState().selectedOrganizationId).toBe("org-2");
    expect(localStorage.getItem("zipship_organization_id")).toBe("org-2");

    expect(useOrganizationsStore.getState().selectOrganization("org-unknown")).toBe(false);
    expect(useOrganizationsStore.getState().selectedOrganizationId).toBe("org-2");
  });

  it("remembers a newly accepted invitation before the organization list refreshes", () => {
    useOrganizationsStore.getState().preferOrganization("org-invited");

    expect(useOrganizationsStore.getState().selectedOrganizationId).toBe("org-invited");
    expect(localStorage.getItem("zipship_organization_id")).toBe("org-invited");
  });
});
