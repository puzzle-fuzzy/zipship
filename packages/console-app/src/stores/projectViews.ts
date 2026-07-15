import type { components } from '@zipship/api-client';

type ProjectDto = components['schemas']['ProjectResponse'];
type ReleaseDto = components['schemas']['ReleaseResponse'];
type DeploymentDto = components['schemas']['DeploymentResponse'];

export interface Project {
  id: string;
  organizationId: string;
  name: string;
  slug: string;
  description: string | null;
  currentReleaseId: string | null;
  spaFallback: boolean;
  cachePolicy: 'standard' | 'aggressive';
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
  action: 'publish' | 'rollback';
  status: 'success' | 'failed';
  operatorId: string;
  message: string | null;
  createdAt: string;
  finishedAt: string | null;
}

export function projectView(project: ProjectDto): Project {
  return {
    id: project.id,
    organizationId: project.organizationId,
    name: project.name,
    slug: project.slug,
    description: project.description ?? null,
    currentReleaseId: project.activeReleaseId ?? null,
    spaFallback: project.spaFallback,
    cachePolicy: cachePolicyView(project.cachePolicy),
    createdBy: project.createdBy,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  };
}

export function releaseView(release: ReleaseDto): Release {
  const artifact = release.artifact ?? null;
  const fullHash = artifact?.sha256 ?? '';

  return {
    id: release.id,
    projectId: release.projectId,
    versionNumber: release.versionNumber,
    releaseHash: fullHash ? fullHash.slice(0, 12) : release.id.slice(0, 8),
    previewUrl: release.previewPath ?? null,
    fullHash,
    status: release.isActive ? 'active' : release.state,
    fileCount: artifact?.fileCount ?? 0,
    totalSize: artifact?.totalSize ?? 0,
    manifest: recordView(artifact?.manifest),
    detectResult: recordView(artifact?.detectReport),
    createdBy: release.createdBy,
    createdAt: release.createdAt,
    archivedAt: release.archivedAt ?? null,
  };
}

export function deploymentView(deployment: DeploymentDto): Deployment {
  return {
    id: deployment.id,
    projectId: deployment.projectId,
    releaseId: deployment.releaseId,
    previousReleaseId: deployment.previousReleaseId ?? null,
    action: deploymentActionView(deployment.action),
    status: deploymentStatusView(deployment.status),
    operatorId: deployment.actorId,
    message: deployment.message ?? null,
    createdAt: deployment.createdAt,
    finishedAt: deployment.finishedAt ?? null,
  };
}

function cachePolicyView(value: string): Project['cachePolicy'] {
  if (value === 'standard' || value === 'aggressive') return value;
  throw new Error(`Unsupported project cache policy: ${value}`);
}

function deploymentActionView(value: string): Deployment['action'] {
  if (value === 'publish' || value === 'rollback') return value;
  throw new Error(`Unsupported deployment action: ${value}`);
}

function deploymentStatusView(value: string): Deployment['status'] {
  if (value === 'succeeded') return 'success';
  if (value === 'failed') return 'failed';
  throw new Error(`Unsupported deployment status: ${value}`);
}

function recordView(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
