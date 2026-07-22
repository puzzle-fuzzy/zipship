import type { components } from "@zipship/api-client";
import { create } from "zustand";
import { getApi } from "../api/client";
import { ApiClientError, mapApiError } from "../api/errors";

const ORGANIZATION_STORAGE_KEY = "zipship_organization_id";

type OrganizationDto = components["schemas"]["OrganizationResponse"];

export interface Organization {
  id: string;
  name: string;
  slug: string;
  role: string;
  createdAt: string;
}

interface OrganizationsState {
  organizations: Organization[];
  selectedOrganizationId: string | null;
  loading: boolean;
  initialized: boolean;
  error: string | null;

  initializeOrganizations: () => Promise<void>;
  selectOrganization: (organizationId: string) => boolean;
  preferOrganization: (organizationId: string) => void;
  resetOrganizations: () => void;
}

let initializeSequence = 0;

export const useOrganizationsStore = create<OrganizationsState>((set, get) => ({
  organizations: [],
  selectedOrganizationId: null,
  loading: false,
  initialized: false,
  error: null,

  initializeOrganizations: async () => {
    const requestSequence = ++initializeSequence;
    set({ loading: true, error: null });
    try {
      const result = await getApi().GET("/_api/organizations");
      if (result.error || !result.data) {
        throw mapApiError(result, {
          codes: {},
          fallback: "Failed to load organizations",
        });
      }
      if (requestSequence !== initializeSequence) return;

      const organizations = result.data.organizations.map(organizationView);
      const preferredId =
        get().selectedOrganizationId ?? readPersistedOrganizationId();
      const selectedOrganizationId =
        organizations.find((organization) => organization.id === preferredId)?.id ??
        organizations[0]?.id ??
        null;
      persistOrganizationId(selectedOrganizationId);
      set({
        organizations,
        selectedOrganizationId,
        loading: false,
        initialized: true,
        error: null,
      });
    } catch (error) {
      if (requestSequence !== initializeSequence) return;
      set({
        organizations: [],
        selectedOrganizationId: null,
        loading: false,
        initialized: true,
        error:
          error instanceof ApiClientError
            ? error.message
            : "Failed to load organizations",
      });
    }
  },

  selectOrganization: (organizationId) => {
    if (!get().organizations.some((organization) => organization.id === organizationId)) {
      return false;
    }
    persistOrganizationId(organizationId);
    set({ selectedOrganizationId: organizationId });
    return true;
  },

  preferOrganization: (organizationId) => {
    persistOrganizationId(organizationId);
    set({ selectedOrganizationId: organizationId });
  },

  resetOrganizations: () => {
    initializeSequence += 1;
    persistOrganizationId(null);
    set({
      organizations: [],
      selectedOrganizationId: null,
      loading: false,
      initialized: false,
      error: null,
    });
  },
}));

function organizationView(organization: OrganizationDto): Organization {
  return {
    id: organization.id,
    name: organization.name,
    slug: organization.slug,
    role: organization.role,
    createdAt: organization.createdAt,
  };
}

function readPersistedOrganizationId(): string | null {
  return typeof window === "undefined"
    ? null
    : window.localStorage.getItem(ORGANIZATION_STORAGE_KEY);
}

function persistOrganizationId(organizationId: string | null) {
  if (typeof window === "undefined") return;
  if (organizationId) {
    window.localStorage.setItem(ORGANIZATION_STORAGE_KEY, organizationId);
  } else {
    window.localStorage.removeItem(ORGANIZATION_STORAGE_KEY);
  }
}
