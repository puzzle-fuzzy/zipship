import type { ApiClient, components } from "@zipship/api-client";
import { create } from "zustand";
import { getApi, getCsrfHeaders } from "../api/client";
import { ApiClientError, API_ERROR_MESSAGES, mapApiError } from "../api/errors";

type ProjectDto = components["schemas"]["ProjectResponse"];
type ReleaseDto = components["schemas"]["ReleaseResponse"];
type DeploymentDto = components["schemas"]["DeploymentResponse"];

export interface Project {
  id: string;
  organizationId: string;
  name: string;
  slug: string;
  description: string | null;
  currentReleaseId: string | null;
  spaFallback: boolean;
  cachePolicy: "standard" | "aggressive";
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
  fileCount: number;
  totalSize: number;
  manifest: Record<string, unknown>;
  detectResult: Record<string, unknown>;
  createdBy: string;
  createdAt: string;
  archivedAt: string | null;
}

export interface Deployment {
  id: string;
  projectId: string;
  releaseId: string;
  previousReleaseId: string | null;
  action: "publish" | "rollback";
  status: "success" | "failed";
  operatorId: string;
  message: string | null;
  createdAt: string;
  finishedAt: string | null;
}

interface ProjectsState {
  projects: Project[];
  releases: Record<string, Release[]>;
  releaseErrors: Record<string, string | null>;
  deployments: Record<string, Deployment[]>;
  deploymentErrors: Record<string, string | null>;
  loading: boolean;

  fetchProjects: () => Promise<void>;
  createProject: (input: {
    name: string;
    slug: string;
    description: string;
  }) => Promise<void>;
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

function projectView(project: ProjectDto): Project {
  return {
    id: project.id,
    organizationId: project.organizationId,
    name: project.name,
    slug: project.slug,
    description: project.description ?? null,
    currentReleaseId: project.activeReleaseId ?? null,
    spaFallback: project.spaFallback,
    cachePolicy: project.cachePolicy as Project["cachePolicy"],
    createdBy: project.createdBy,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  };
}

function releaseView(release: ReleaseDto): Release {
  const artifact = release.artifact ?? null;
  const fullHash = artifact?.sha256 ?? "";
  return {
    id: release.id,
    projectId: release.projectId,
    versionNumber: release.versionNumber,
    releaseHash: fullHash ? fullHash.slice(0, 12) : release.id.slice(0, 8),
    previewUrl: release.previewPath ?? null,
    fullHash,
    status: release.isActive ? "active" : release.state,
    fileCount: artifact?.fileCount ?? 0,
    totalSize: artifact?.totalSize ?? 0,
    manifest: (artifact?.manifest ?? {}) as Record<string, unknown>,
    detectResult: (artifact?.detectReport ?? {}) as Record<string, unknown>,
    createdBy: release.createdBy,
    createdAt: release.createdAt,
    archivedAt: release.archivedAt ?? null,
  };
}

function deploymentView(deployment: DeploymentDto): Deployment {
  return {
    id: deployment.id,
    projectId: deployment.projectId,
    releaseId: deployment.releaseId,
    previousReleaseId: deployment.previousReleaseId ?? null,
    action: deployment.action as Deployment["action"],
    status: deployment.status === "succeeded" ? "success" : "failed",
    operatorId: deployment.actorId,
    message: deployment.message ?? null,
    createdAt: deployment.createdAt,
    finishedAt: deployment.finishedAt ?? null,
  };
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
    releases: {},
    releaseErrors: {},
    deployments: {},
    deploymentErrors: {},
    loading: true,

    fetchProjects: async () => {
      set({ loading: true });
      try {
        const organizations = await getApi().GET("/_api/organizations");
        const organization = organizations.data?.organizations[0];
        if (!organization) {
          set({ projects: [], loading: false });
          return;
        }
        const projects = await getApi().GET(
          "/_api/organizations/{organization_id}/projects",
          { params: { path: { organization_id: organization.id } } },
        );
        if (projects.error || !projects.data) {
          throw mapApiError(projects, {
            codes: projectAccessErrorCodes,
            fallback: "Failed to load projects",
          });
        }
        set({
          projects: projects.data.projects.map(projectView),
          loading: false,
        });
      } catch (error) {
        console.error("Failed to fetch projects", error);
        set({ loading: false });
      }
    },

    createProject: async (input) => {
      const organizations = await getApi().GET("/_api/organizations");
      const organizationId = organizations.data?.organizations[0]?.id;
      if (!organizationId) throw new Error("No organization found");
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
