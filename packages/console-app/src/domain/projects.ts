import type {
  AccessPlaneCachePolicy,
  DeploymentAction,
  ReleaseStatus,
} from '@zipship/shared';

export interface Project {
  id: string;
  organizationId: string;
  name: string;
  slug: string;
  description: string | null;
  currentReleaseId: string | null;
  spaFallback: boolean;
  cachePolicy: AccessPlaneCachePolicy;
  customDomains: string[];
  status: 'active';
  visibility: 'private';
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
  status: ReleaseStatus;
  storagePath: string;
  rawUploadPath: string | null;
  fileCount: number;
  totalSize: number;
  manifest: Record<string, unknown>;
  detectResult: Record<string, unknown>;
  createdBy: string;
  createdAt: string;
  activatedAt: string | null;
  archivedAt: string | null;
}

export interface Deployment {
  id: string;
  projectId: string;
  releaseId: string;
  previousReleaseId: string | null;
  action: Extract<DeploymentAction, 'publish' | 'rollback'>;
  status: 'success';
  operatorId: string;
  message: string | null;
  createdAt: string;
  finishedAt: string | null;
}

export interface ProjectCreateInput {
  name: string;
  slug: string;
  description: string;
}

export interface ProjectUpdateInput {
  name?: string;
  slug?: string;
  description?: string | null;
  spaFallback?: boolean;
  cachePolicy?: AccessPlaneCachePolicy;
  customDomains?: string[];
}
