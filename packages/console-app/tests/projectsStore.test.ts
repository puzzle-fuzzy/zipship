import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockApi, type MockApi } from './helpers/mockApi';

const { mockApi, setMockApi } = vi.hoisted(() => {
  let current: unknown;
  return { mockApi: () => current, setMockApi: (api: unknown) => { current = api; } };
});

vi.mock('../src/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/api/client')>();
  return { ...actual, getApi: () => mockApi() };
});

const { useProjectsStore } = await import('../src/stores/projectsStore');
let api: MockApi;

const project = {
  id: 'p1',
  organizationId: 'org-1',
  name: 'Docs',
  slug: 'docs',
  description: 'Documentation',
  activeReleaseId: null,
  spaFallback: true,
  cachePolicy: 'standard',
  createdBy: 'u1',
  createdAt: '2026-07-15T00:00:00Z',
  updatedAt: '2026-07-15T00:00:00Z',
};
const release = {
  id: 'r1',
  projectId: 'p1',
  versionNumber: 1,
  state: 'ready',
  isActive: false,
  previewPath: '/_sites/docs/0123456789ab/',
  artifact: {
    sha256: '0123456789abcdef',
    fileCount: 4,
    totalSize: 1024,
    manifest: { version: 1, files: [] },
    detectReport: {},
  },
  createdBy: 'u1',
  createdAt: '2026-07-15T00:00:00Z',
};
const deployment = {
  id: 'd1',
  projectId: 'p1',
  releaseId: 'r1',
  previousReleaseId: null,
  action: 'publish',
  status: 'succeeded',
  actorId: 'u1',
  message: 'Ship docs',
  createdAt: '2026-07-15T00:00:00Z',
  finishedAt: '2026-07-15T00:00:01Z',
};

beforeEach(() => {
  api = createMockApi();
  setMockApi(api._api);
  document.cookie = 'zipship_csrf=test-csrf; Path=/';
  useProjectsStore.setState({
    projects: [],
    releases: {},
    releaseErrors: {},
    deployments: {},
    deploymentErrors: {},
    loading: true,
  });
});

describe('projectsStore', () => {
  it('loads the first organization and adapts Rust project fields', async () => {
    api.verb('get')
      .mockResolvedValueOnce({ data: { organizations: [{ id: 'org-1' }] } })
      .mockResolvedValueOnce({ data: { projects: [project] } });

    await useProjectsStore.getState().fetchProjects();

    expect(api.verb('get').mock.calls).toEqual([
      ['/_api/organizations'],
      ['/_api/organizations/{organization_id}/projects', { params: { path: { organization_id: 'org-1' } } }],
    ]);
    expect(useProjectsStore.getState()).toMatchObject({
      loading: false,
      projects: [{ id: 'p1', currentReleaseId: null, cachePolicy: 'standard' }],
    });
  });

  it('finishes with an empty list when the user has no organization', async () => {
    api.verb('get').mockResolvedValueOnce({ data: { organizations: [] } });
    await useProjectsStore.getState().fetchProjects();
    expect(useProjectsStore.getState()).toMatchObject({ projects: [], loading: false });
  });

  it('creates a project with CSRF and the Rust request body', async () => {
    api.verb('get').mockResolvedValueOnce({ data: { organizations: [{ id: 'org-1' }] } });
    api.verb('post').mockResolvedValueOnce({ data: { project } });
    await useProjectsStore.getState().createProject({ name: 'Docs', slug: 'docs', description: '' });
    expect(api.verb('post')).toHaveBeenCalledWith(
      '/_api/organizations/{organization_id}/projects',
      {
        params: {
          path: { organization_id: 'org-1' },
          header: { 'x-csrf-token': 'test-csrf' },
        },
        body: { name: 'Docs', slug: 'docs', description: null },
      },
    );
  });

  it('retains duplicate slug errors from the Rust API', async () => {
    api.verb('get').mockResolvedValueOnce({ data: { organizations: [{ id: 'org-1' }] } });
    api.verb('post').mockResolvedValueOnce({ error: { code: 'DUPLICATE_PROJECT_SLUG' } });
    await expect(
      useProjectsStore.getState().createProject({ name: 'Docs', slug: 'docs', description: '' }),
    ).rejects.toThrow('A project with this slug already exists');
  });

  it('adapts releases and deployments for the current Console view', async () => {
    api.verb('get')
      .mockResolvedValueOnce({ data: { releases: [release] } })
      .mockResolvedValueOnce({ data: { deployments: [deployment] } });
    await useProjectsStore.getState().fetchReleases('p1');
    await useProjectsStore.getState().fetchDeployments('p1');
    expect(useProjectsStore.getState().releases.p1[0]).toMatchObject({
      id: 'r1',
      releaseHash: '0123456789ab',
      previewUrl: '/_sites/docs/0123456789ab/',
      fileCount: 4,
      status: 'ready',
    });
    expect(useProjectsStore.getState().deployments.p1[0]).toMatchObject({
      id: 'd1',
      status: 'success',
      operatorId: 'u1',
    });
  });

  it('publishes with CSRF and idempotency, then refreshes release state', async () => {
    api.verb('post').mockResolvedValueOnce({ data: { deployment } });
    api.verb('get')
      .mockResolvedValueOnce({ data: { releases: [{ ...release, isActive: true }] } })
      .mockResolvedValueOnce({ data: { deployments: [deployment] } });

    await useProjectsStore.getState().publishRelease('p1', 'r1', 'Ship docs');

    expect(api.verb('post')).toHaveBeenCalledWith(
      '/_api/projects/{project_id}/releases/{release_id}/publish',
      expect.objectContaining({
        params: {
          path: { project_id: 'p1', release_id: 'r1' },
          header: {
            'x-csrf-token': 'test-csrf',
            'idempotency-key': expect.any(String),
          },
        },
        body: { message: 'Ship docs' },
      }),
    );
    expect(useProjectsStore.getState().releases.p1[0].status).toBe('active');
  });

  it('does not refresh after a rejected rollback', async () => {
    api.verb('post').mockResolvedValueOnce({ error: { code: 'FORBIDDEN' } });
    await expect(useProjectsStore.getState().rollbackRelease('p1', 'r1')).rejects.toThrow(
      'Failed to roll back release',
    );
    expect(api.verb('get')).not.toHaveBeenCalled();
  });

  it('replaces a project from the returned update envelope', async () => {
    useProjectsStore.setState({ projects: [project as never] });
    api.verb('patch').mockResolvedValueOnce({ data: { project: { ...project, name: 'New docs' } } });
    await useProjectsStore.getState().updateProject('p1', { name: 'New docs' });
    expect(useProjectsStore.getState().projects[0].name).toBe('New docs');
  });
});
