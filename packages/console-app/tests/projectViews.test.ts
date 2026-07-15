import { describe, expect, it } from 'vitest';
import {
  deploymentView,
  projectView,
  releaseView,
} from '../src/stores/projectViews';

const project = {
  id: 'p1',
  organizationId: 'org-1',
  name: 'Docs',
  slug: 'docs',
  description: null,
  activeReleaseId: null,
  spaFallback: true,
  cachePolicy: 'standard',
  createdBy: 'u1',
  createdAt: '2026-07-15T00:00:00Z',
  updatedAt: '2026-07-15T00:00:00Z',
} as const;

const release = {
  id: 'release-without-artifact',
  projectId: 'p1',
  versionNumber: 1,
  state: 'processing',
  isActive: false,
  previewPath: null,
  artifact: null,
  createdBy: 'u1',
  createdAt: '2026-07-15T00:00:00Z',
  archivedAt: null,
} as const;

const deployment = {
  id: 'd1',
  projectId: 'p1',
  releaseId: 'r1',
  previousReleaseId: null,
  action: 'publish',
  status: 'succeeded',
  actorId: 'u1',
  message: null,
  createdAt: '2026-07-15T00:00:00Z',
  finishedAt: null,
} as const;

describe('project API views', () => {
  it('maps project identity and cache settings', () => {
    expect(projectView(project)).toMatchObject({
      id: 'p1',
      currentReleaseId: null,
      cachePolicy: 'standard',
    });
  });

  it('provides safe release fallbacks before artifact processing finishes', () => {
    expect(releaseView(release)).toMatchObject({
      releaseHash: 'release-',
      status: 'processing',
      fileCount: 0,
      totalSize: 0,
      manifest: {},
      detectResult: {},
    });
  });

  it('maps only known deployment states', () => {
    expect(deploymentView(deployment)).toMatchObject({
      action: 'publish',
      status: 'success',
      operatorId: 'u1',
    });
    expect(() =>
      deploymentView({ ...deployment, status: 'queued' } as never),
    ).toThrow('Unsupported deployment status: queued');
  });

  it('rejects unknown cache policies instead of hiding contract drift', () => {
    expect(() => projectView({ ...project, cachePolicy: 'forever' } as never)).toThrow(
      'Unsupported project cache policy: forever',
    );
  });
});
