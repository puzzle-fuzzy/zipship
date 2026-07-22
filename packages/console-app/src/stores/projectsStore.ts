import type { ApiClient, components } from "@zipship/api-client";
import { create } from "zustand";
import { getApi, getCsrfHeaders } from "../api/client";
import {
  ApiClientError,
  API_ERROR_MESSAGES,
  getApiErrorCode,
  mapApiError,
} from "../api/errors";
import {
  deploymentView,
  projectView,
  releaseView,
  type Deployment,
  type Project,
  type Release,
} from "./projectViews";

export type { Deployment, Project, Release } from "./projectViews";

type ReleaseDto = components["schemas"]["ReleaseResponse"];
type DeploymentDto = components["schemas"]["DeploymentResponse"];

interface ProjectsState {
  projects: Project[];
  projectsOrganizationId: string | null;
  projectsError: string | null;
  releases: Record<string, Release[]>;
  releaseErrors: Record<string, string | null>;
  deployments: Record<string, Deployment[]>;
  deploymentErrors: Record<string, string | null>;
  loading: boolean;

  fetchProjects: (organizationId: string | null) => Promise<void>;
  resolveProject: (projectId: string) => Promise<Project | null>;
  createProject: (
    organizationId: string,
    input: {
      name: string;
      slug: string;
      description: string;
    },
  ) => Promise<void>;
  fetchReleases: (projectId: string) => Promise<void>;
  fetchDeployments: (projectId: string) => Promise<void>;
  publishRelease: (
    projectId: string,
    releaseId: string,
    message?: string | null,
  ) => Promise<void>;
  rollbackRelease: (
    projectId: string,
    releaseId: string,
    message?: string | null,
  ) => Promise<void>;
  updateProject: (
    projectId: string,
    input: {
      name?: string;
      slug?: string;
      description?: string | null;
      spaFallback?: boolean;
      cachePolicy?: "standard" | "aggressive";
    },
  ) => Promise<void>;
}

let projectsRequestSequence = 0;

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

  const storeReleases = (projectId: string, releases: ReleaseDto[]) => {
    set((state) => ({
      releases: {
        ...state.releases,
        [projectId]: releases.map(releaseView),
      },
      releaseErrors: { ...state.releaseErrors, [projectId]: null },
    }));
  };

  const storeDeployments = (
    projectId: string,
    deployments: DeploymentDto[],
  ) => {
    set((state) => ({
      deployments: {
        ...state.deployments,
        [projectId]: deployments.map(deploymentView),
      },
      deploymentErrors: { ...state.deploymentErrors, [projectId]: null },
    }));
  };

  const refreshReleaseAndDeploymentState = async (
    api: ApiClient,
    projectId: string,
  ) => {
    const releases = await api.GET("/_api/projects/{project_id}/releases", {
      params: { path: { project_id: projectId } },
    });
    if (releases.data) storeReleases(projectId, releases.data.releases);

    const deployments = await api.GET(
      "/_api/projects/{project_id}/deployments",
      { params: { path: { project_id: projectId } } },
    );
    if (deployments.data) {
      storeDeployments(projectId, deployments.data.deployments);
    }
  };

  return {
    projects: [],
    projectsOrganizationId: null,
    projectsError: null,
    releases: {},
    releaseErrors: {},
    deployments: {},
    deploymentErrors: {},
    loading: true,

    fetchProjects: async (organizationId) => {
      const requestSequence = ++projectsRequestSequence;
      if (!organizationId) {
        set({
          projects: [],
          projectsOrganizationId: null,
          projectsError: null,
          loading: false,
        });
        return;
      }
      set({
        projects: [],
        projectsOrganizationId: organizationId,
        projectsError: null,
        loading: true,
      });
      try {
        const projects = await getApi().GET(
          "/_api/organizations/{organization_id}/projects",
          { params: { path: { organization_id: organizationId } } },
        );
        if (projects.error || !projects.data) {
          throw mapApiError(projects, {
            codes: projectAccessErrorCodes,
            fallback: "Failed to load projects",
          });
        }
        if (requestSequence !== projectsRequestSequence) return;
        set({
          projects: projects.data.projects.map(projectView),
          loading: false,
        });
      } catch (error) {
        if (requestSequence !== projectsRequestSequence) return;
        console.error("Failed to fetch projects", error);
        set({
          projects: [],
          loading: false,
          projectsError:
            error instanceof ApiClientError
              ? error.message
              : "Failed to load projects",
        });
      }
    },

    resolveProject: async (projectId) => {
      const result = await getApi().GET("/_api/projects/{project_id}", {
        params: { path: { project_id: projectId } },
      });
      if (result.error || !result.data) {
        const code = getApiErrorCode(result);
        if (code === "PROJECT_NOT_FOUND" || code === "INVALID_PATH_PARAMETER") {
          return null;
        }
        throw mapApiError(result, {
          codes: projectAccessErrorCodes,
          fallback: "Failed to load project",
        });
      }
      return projectView(result.data.project);
    },

    createProject: async (organizationId, input) => {
      const result = await getApi().POST(
        "/_api/organizations/{organization_id}/projects",
        {
          params: {
            path: { organization_id: organizationId },
            header: getCsrfHeaders(),
          },
          body: {
            name: input.name,
            slug: input.slug,
            description: input.description || null,
          },
        },
      );
      if (result.error) {
        throw mapApiError(result, {
          codes: {
            DUPLICATE_PROJECT_SLUG:
              API_ERROR_MESSAGES.DUPLICATE_PROJECT_SLUG,
          },
          fallback: "Failed to create project",
        });
      }
    },

    fetchReleases: async (projectId) => {
      setReleaseError(projectId, null);
      try {
        const result = await getApi().GET(
          "/_api/projects/{project_id}/releases",
          { params: { path: { project_id: projectId } } },
        );
        if (result.error || !result.data) {
          throw mapApiError(result, {
            codes: projectAccessErrorCodes,
            fallback: "Failed to load releases",
          });
        }
        storeReleases(projectId, result.data.releases);
      } catch (error) {
        console.error("Failed to fetch releases", error);
        setReleaseError(
          projectId,
          error instanceof ApiClientError
            ? error.message
            : "Failed to load releases",
        );
      }
    },

    fetchDeployments: async (projectId) => {
      setDeploymentError(projectId, null);
      try {
        const result = await getApi().GET(
          "/_api/projects/{project_id}/deployments",
          { params: { path: { project_id: projectId } } },
        );
        if (result.error || !result.data) {
          throw mapApiError(result, {
            codes: projectAccessErrorCodes,
            fallback: "Failed to load deployment history",
          });
        }
        storeDeployments(projectId, result.data.deployments);
      } catch (error) {
        console.error("Failed to fetch deployments", error);
        setDeploymentError(
          projectId,
          error instanceof ApiClientError
            ? error.message
            : "Failed to load deployment history",
        );
      }
    },

    publishRelease: async (projectId, releaseId, message = null) => {
      const api = getApi();
      const result = await api.POST(
        "/_api/projects/{project_id}/releases/{release_id}/publish",
        {
          params: {
            path: { project_id: projectId, release_id: releaseId },
            header: {
              ...getCsrfHeaders(),
              "idempotency-key": crypto.randomUUID(),
            },
          },
          body: { message },
        },
      );
      if (result.error) {
        throw mapApiError(result, {
          codes: {},
          fallback: "Failed to publish release",
        });
      }
      await refreshReleaseAndDeploymentState(api, projectId);
    },

    rollbackRelease: async (projectId, releaseId, message = null) => {
      const api = getApi();
      const result = await api.POST(
        "/_api/projects/{project_id}/releases/{release_id}/rollback",
        {
          params: {
            path: { project_id: projectId, release_id: releaseId },
            header: {
              ...getCsrfHeaders(),
              "idempotency-key": crypto.randomUUID(),
            },
          },
          body: { message },
        },
      );
      if (result.error) {
        throw mapApiError(result, {
          codes: {},
          fallback: "Failed to roll back release",
        });
      }
      await refreshReleaseAndDeploymentState(api, projectId);
    },

    updateProject: async (projectId, input) => {
      const result = await getApi().PATCH("/_api/projects/{project_id}", {
        params: {
          path: { project_id: projectId },
          header: getCsrfHeaders(),
        },
        body: input,
      });
      if (result.error) {
        throw mapApiError(result, {
          codes: {
            DUPLICATE_PROJECT_SLUG:
              API_ERROR_MESSAGES.DUPLICATE_PROJECT_SLUG,
            FORBIDDEN: API_ERROR_MESSAGES.FORBIDDEN,
          },
          fallback: "Failed to update project",
        });
      }
      if (result.data) {
        const updated = projectView(result.data.project);
        set((state) => ({
          projects: state.projects.map((project) =>
            project.id === updated.id ? updated : project,
          ),
        }));
      }
    },
  };
});
