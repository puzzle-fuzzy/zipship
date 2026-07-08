import { create } from 'zustand';
import { authHeaders, getAccessToken, getApi } from '../api/client';
import { API_ERROR_MESSAGES, mapApiError } from '../api/errors';

export interface Project {
  id: string;
  organizationId: string;
  name: string;
  slug: string;
  description: string | null;
  currentReleaseId: string | null;
  status: string;
  visibility: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface Release {
  id: string;
  projectId: string;
  versionNumber: number;
  releaseHash: string;
  previewUrl: string | null;
  fullHash: string;
  status: string;
  storagePath: string;
  rawUploadPath: string;
  fileCount: number;
  totalSize: number;
  manifest: Record<string, unknown>;
  detectResult: Record<string, unknown>;
  createdBy: string;
  createdAt: string;
  activatedAt: string | null;
  archivedAt: string | null;
}

interface ProjectsState {
  projects: Project[];
  releases: Record<string, Release[]>; // projectId -> releases
  loading: boolean;

  fetchProjects: () => Promise<void>;
  createProject: (input: { name: string; slug: string; description: string }) => Promise<void>;
  fetchReleases: (projectId: string) => Promise<void>;
  publishRelease: (projectId: string, releaseId: string) => Promise<void>;
  deleteProject: (projectId: string) => Promise<void>;
  updateProject: (
    projectId: string,
    input: { name?: string; slug?: string; description?: string | null },
  ) => Promise<void>;
}

export const useProjectsStore = create<ProjectsState>((set) => ({
  projects: [],
  releases: {},
  loading: true,

  fetchProjects: async () => {
    const api = getApi();
    try {
      const orgRes = await api._api.organizations.get({ headers: authHeaders() });

      if (orgRes.error) {
        console.error('Failed to fetch projects: org error', orgRes.error);
        set({ loading: false });
        return;
      }

      const org = orgRes.data?.organizations?.[0];
      if (!org?.id) {
        console.error('Failed to fetch projects: no org data', orgRes.data);
        set({ loading: false });
        return;
      }

      const projRes = await api._api.organizations({ organizationId: org.id }).projects.get({
        headers: authHeaders(),
      });

      if (projRes.error) {
        console.error('Failed to fetch projects: projects error', projRes.error);
        set({ loading: false });
        return;
      }

      if (projRes.data) {
        set({ projects: projRes.data.projects as Project[], loading: false });
      }
    } catch (err) {
      console.error('Failed to fetch projects:', err);
      set({ loading: false });
    }
  },

  createProject: async (input) => {
    const api = getApi();

    // 1. Look up the user's default organization
    const orgRes = await api._api.organizations.get({ headers: authHeaders() });

    if (orgRes.error) {
      throw mapApiError(orgRes, {
        codes: { UNAUTHORIZED: 'Session expired, please refresh' },
        fallback: 'Failed to get organization',
      });
    }

    const orgId = orgRes.data?.organizations?.[0]?.id;
    if (!orgId) throw new Error('No organization found');

    // 2. Create the project
    const res = await api._api.organizations({ organizationId: orgId }).projects.post(
      { name: input.name, slug: input.slug, description: input.description || null },
      { headers: authHeaders() },
    );

    if (res.error) {
      throw mapApiError(res, {
        codes: { DUPLICATE_PROJECT_SLUG: API_ERROR_MESSAGES.DUPLICATE_PROJECT_SLUG },
        fallback: 'Failed to create project',
      });
    }
  },

  fetchReleases: async (projectId) => {
    const api = getApi();
    try {
      const res = await api._api.projects({ projectId }).releases.get({
        headers: authHeaders(),
      });
      if (res.data) {
        set((state) => ({
          releases: { ...state.releases, [projectId]: res.data!.releases as Release[] },
        }));
      }
    } catch (err) {
      console.error('Failed to fetch releases:', err);
    }
  },

  publishRelease: async (projectId, releaseId) => {
    const api = getApi();
    const headers = authHeaders();
    const res = await api._api.projects({ projectId }).releases({ releaseId }).publish.post(
      { message: null },
      { headers },
    );
    if (res.error) {
      throw mapApiError(res, { codes: {}, fallback: 'Failed to publish release' });
    }
    // Refresh releases to get updated status
    const refreshRes = await api._api.projects({ projectId }).releases.get({ headers });
    if (refreshRes.data) {
      set((state) => ({
        releases: { ...state.releases, [projectId]: refreshRes.data!.releases as Release[] },
      }));
    }
  },

  deleteProject: async (projectId) => {
    const api = getApi();
    const res = await api._api.projects({ projectId }).delete({ headers: authHeaders() });
    if (res.error) {
      throw mapApiError(res, {
        codes: { FORBIDDEN: 'No permission to delete this project' },
        fallback: 'Failed to delete project',
      });
    }
    // Remove from local state
    set((state) => ({
      projects: state.projects.filter((p) => p.id !== projectId),
    }));
  },

  updateProject: async (projectId, input) => {
    const api = getApi();
    const res = await api._api.projects({ projectId }).patch(input, {
      headers: authHeaders(),
    });
    if (res.error) {
      throw new Error('Failed to update project');
    }
  },
}));

// `getAccessToken` re-exported for components (e.g. preview-link builders) that
// need the token without going through the store.
export { getAccessToken };
