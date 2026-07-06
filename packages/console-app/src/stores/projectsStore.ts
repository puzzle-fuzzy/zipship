import { createApiClient } from '@zipship/api-client';
import { create } from 'zustand';

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
  releases: Record<string, Release[]>;  // projectId -> releases
  loading: boolean;

  fetchProjects: (apiBaseUrl: string, refreshToken: string) => Promise<void>;
  createProject: (apiBaseUrl: string, refreshToken: string, input: { name: string; slug: string; description: string }) => Promise<void>;
  fetchReleases: (apiBaseUrl: string, refreshToken: string, projectId: string) => Promise<void>;
}

export const useProjectsStore = create<ProjectsState>((set) => ({
  projects: [],
  releases: {},
  loading: true,

  fetchProjects: async (apiBaseUrl: string, refreshToken: string) => {
    const api = createApiClient(apiBaseUrl);
    try {
      const orgRes = await api._api.organizations.get({
        headers: { authorization: `Bearer ${refreshToken}` },
      });
      const orgId = orgRes.data?.organizations[0]?.id;
      if (!orgId) return;

      const projRes = await api._api.organizations({ organizationId: orgId }).projects.get({
        headers: { authorization: `Bearer ${refreshToken}` },
      });

      if (projRes.data) {
        set({ projects: projRes.data.projects as Project[], loading: false });
      }
    } catch (err) {
      console.error('Failed to fetch projects:', err);
      set({ loading: false });
    }
  },

  createProject: async (apiBaseUrl, refreshToken, input) => {
    const api = createApiClient(apiBaseUrl);
    const orgRes = await api._api.organizations.get({
      headers: { authorization: `Bearer ${refreshToken}` },
    });
    const orgId = orgRes.data?.organizations[0]?.id;
    if (!orgId) throw new Error('No organization found');

    const res = await api._api.organizations({ organizationId: orgId }).projects.post(
      { name: input.name, slug: input.slug, description: input.description || null },
      { headers: { authorization: `Bearer ${refreshToken}` } },
    );

    if (res.error) {
      const code = (res.error.value as { code?: string })?.code;
      throw new Error(code === 'DUPLICATE_PROJECT_SLUG' ? 'A project with this slug already exists' : 'Failed to create project');
    }
  },

  fetchReleases: async (apiBaseUrl, refreshToken, projectId) => {
    const api = createApiClient(apiBaseUrl);
    try {
      const res = await api._api.projects({ projectId }).releases.get({
        headers: { authorization: `Bearer ${refreshToken}` },
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
}));
