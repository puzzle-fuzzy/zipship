import { create } from 'zustand';
import { authHeaders, getAccessToken, getApi } from '../api/client';
import { API_ERROR_MESSAGES, mapApiError } from '../api/errors';
import type {
  Deployment,
  Project,
  ProjectCreateInput,
  ProjectUpdateInput,
  Release,
} from '../domain/projects';

export type { Deployment, Project, Release } from '../domain/projects';

interface ProjectsState {
  projects: Project[];
  releases: Record<string, Release[]>; // projectId -> releases
  releaseErrors: Record<string, string | null>;
  deployments: Record<string, Deployment[]>; // projectId -> deployments
  deploymentErrors: Record<string, string | null>;
  loading: boolean;

  fetchProjects: () => Promise<void>;
  createProject: (input: ProjectCreateInput) => Promise<void>;
  fetchReleases: (projectId: string) => Promise<void>;
  fetchDeployments: (projectId: string) => Promise<void>;
  publishRelease: (projectId: string, releaseId: string, message?: string | null) => Promise<void>;
  rollbackRelease: (projectId: string, releaseId: string, message?: string | null) => Promise<void>;
  deleteProject: (projectId: string) => Promise<void>;
  updateProject: (projectId: string, input: ProjectUpdateInput) => Promise<void>;
}

export const useProjectsStore = create<ProjectsState>((set) => {
  const projectAccessErrorCodes = {
    FORBIDDEN: API_ERROR_MESSAGES.FORBIDDEN,
    PROJECT_NOT_FOUND: API_ERROR_MESSAGES.PROJECT_NOT_FOUND,
  };

  const setReleaseError = (projectId: string, error: string | null) => {
    set((state) => ({
      releaseErrors: { ...state.releaseErrors, [projectId]: error },
    }));
  };

  const setDeploymentError = (projectId: string, error: string | null) => {
    set((state) => ({
      deploymentErrors: { ...state.deploymentErrors, [projectId]: error },
    }));
  };

  const storeReleases = (projectId: string, releases: Release[]) => {
    set((state) => ({
      releases: { ...state.releases, [projectId]: releases },
      releaseErrors: { ...state.releaseErrors, [projectId]: null },
    }));
  };

  const storeDeployments = (projectId: string, deployments: Deployment[]) => {
    set((state) => ({
      deployments: { ...state.deployments, [projectId]: deployments },
      deploymentErrors: { ...state.deploymentErrors, [projectId]: null },
    }));
  };

  const refreshReleaseAndDeploymentState = async (
    api: ReturnType<typeof getApi>,
    projectId: string,
    headers: ReturnType<typeof authHeaders>,
  ) => {
    const refreshRes = await api._api.projects({ projectId }).releases.get({ headers });
    if (refreshRes.data) {
      storeReleases(projectId, refreshRes.data.releases as Release[]);
    }

    const deploymentsRes = await api._api.projects({ projectId }).deployments.get({ headers });
    if (deploymentsRes.data) {
      storeDeployments(projectId, deploymentsRes.data.deployments as Deployment[]);
    }
  };

  return ({
  projects: [],
  releases: {},
  releaseErrors: {},
  deployments: {},
  deploymentErrors: {},
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
    setReleaseError(projectId, null);
    try {
      const res = await api._api.projects({ projectId }).releases.get({
        headers: authHeaders(),
      });
      if (res.error) {
        const error = mapApiError(res, {
          codes: projectAccessErrorCodes,
          fallback: 'Failed to load releases',
        });
        setReleaseError(projectId, error.message);
        return;
      }
      if (res.data) {
        storeReleases(projectId, res.data.releases as Release[]);
      }
    } catch (err) {
      console.error('Failed to fetch releases:', err);
      setReleaseError(projectId, 'Failed to load releases');
    }
  },

  fetchDeployments: async (projectId) => {
    const api = getApi();
    setDeploymentError(projectId, null);
    try {
      const res = await api._api.projects({ projectId }).deployments.get({
        headers: authHeaders(),
      });
      if (res.error) {
        const error = mapApiError(res, {
          codes: projectAccessErrorCodes,
          fallback: 'Failed to load deployment history',
        });
        setDeploymentError(projectId, error.message);
        return;
      }
      if (res.data) {
        storeDeployments(projectId, res.data.deployments as Deployment[]);
      }
    } catch (err) {
      console.error('Failed to fetch deployments:', err);
      setDeploymentError(projectId, 'Failed to load deployment history');
    }
  },

  publishRelease: async (projectId, releaseId, message = null) => {
    const api = getApi();
    const headers = authHeaders();
    const res = await api._api.projects({ projectId }).releases({ releaseId }).publish.post(
      { message },
      { headers },
    );
    if (res.error) {
      throw mapApiError(res, { codes: {}, fallback: 'Failed to publish release' });
    }
    await refreshReleaseAndDeploymentState(api, projectId, headers);
  },

  rollbackRelease: async (projectId, releaseId, message = null) => {
    const api = getApi();
    const headers = authHeaders();
    const res = await api._api.projects({ projectId }).releases({ releaseId }).rollback.post(
      { message },
      { headers },
    );
    if (res.error) {
      throw mapApiError(res, { codes: {}, fallback: 'Failed to roll back release' });
    }
    await refreshReleaseAndDeploymentState(api, projectId, headers);
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
      throw mapApiError(res, {
        codes: {
          DUPLICATE_PROJECT_SLUG: API_ERROR_MESSAGES.DUPLICATE_PROJECT_SLUG,
          FORBIDDEN: API_ERROR_MESSAGES.FORBIDDEN,
        },
        fallback: 'Failed to update project',
      });
    }
  },
  });
});

// `getAccessToken` re-exported for components (e.g. preview-link builders) that
// need the token without going through the store.
export { getAccessToken };
