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

const { useAuditStore } = await import('../src/stores/auditStore');
let api: MockApi;

beforeEach(() => {
  api = createMockApi();
  setMockApi(api._api);
  useAuditStore.setState({ logs: [], loading: false, error: null });
});

describe('auditStore', () => {
  it('loads and adapts organization audit entries', async () => {
    api.verb('get').mockResolvedValueOnce({
      data: {
        items: [{
          id: 'a1',
          action: 'release.published',
          actor: { id: 'u1', displayName: 'Ada', email: 'ada@example.com' },
          targetType: 'release',
          targetId: 'r1',
          projectId: 'p1',
          metadata: {},
          createdAt: '2026-07-15T00:00:00Z',
        }],
      },
    });

    await useAuditStore.getState().fetchAudit('org-1');

    expect(api.verb('get')).toHaveBeenCalledWith(
      '/_api/organizations/{organization_id}/audit-logs',
      { params: { path: { organization_id: 'org-1' } } },
    );
    expect(useAuditStore.getState()).toMatchObject({
      loading: false,
      error: null,
      logs: [{ id: 'a1', actorId: 'u1', projectId: 'p1' }],
    });
  });

  it('finishes loading with a stable error on API and network failures', async () => {
    api.verb('get').mockResolvedValueOnce({ error: { code: 'FORBIDDEN' } });
    await useAuditStore.getState().fetchAudit('org-1');
    expect(useAuditStore.getState()).toMatchObject({ loading: false, error: 'Failed to load activity' });

    api.verb('get').mockRejectedValueOnce(new Error('network'));
    await useAuditStore.getState().fetchAudit('org-1');
    expect(useAuditStore.getState()).toMatchObject({ loading: false, error: 'Failed to load activity' });
  });
});
