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

const { useMembersStore } = await import('../src/stores/membersStore');
let api: MockApi;
const member = {
  userId: 'u1',
  displayName: 'Ada',
  email: 'ada@example.com',
  role: 'owner',
  joinedAt: '2026-07-15T00:00:00Z',
};

beforeEach(() => {
  api = createMockApi();
  setMockApi(api._api);
  document.cookie = 'zipship_csrf=test-csrf; Path=/';
  useMembersStore.setState({ members: [], loading: false, error: null });
});

describe('membersStore', () => {
  it('loads and adapts organization members', async () => {
    api.verb('get').mockResolvedValueOnce({ data: { members: [member] } });
    await useMembersStore.getState().fetchMembers('org-1');
    expect(api.verb('get')).toHaveBeenCalledWith('/_api/organizations/{organization_id}/members', {
      params: { path: { organization_id: 'org-1' } },
    });
    expect(useMembersStore.getState()).toMatchObject({
      loading: false,
      error: null,
      members: [{ id: 'u1', userId: 'u1', name: 'Ada', role: 'owner' }],
    });
  });

  it('finishes loading with an error on network failure', async () => {
    api.verb('get').mockRejectedValueOnce(new Error('network'));
    await useMembersStore.getState().fetchMembers('org-1');
    expect(useMembersStore.getState()).toMatchObject({ loading: false, error: 'Failed to fetch members' });
  });

  it('creates an invitation and keeps its bearer credential in the fragment', async () => {
    api.verb('post').mockResolvedValueOnce({ data: { acceptToken: 'secret-token' } });
    const result = await useMembersStore.getState().inviteMember('org-1', 'new@example.com', 'developer');
    expect(api.verb('post')).toHaveBeenCalledWith(
      '/_api/organizations/{organization_id}/invitations',
      {
        params: {
          path: { organization_id: 'org-1' },
          header: { 'x-csrf-token': 'test-csrf' },
        },
        body: { email: 'new@example.com', role: 'developer' },
      },
    );
    const url = new URL(result.inviteUrl);
    expect(url.pathname).toBe('/invitations/accept');
    expect(url.search).toBe('');
    expect(url.hash).toBe('#token=secret-token');
  });

  it('maps duplicate pending invitations from the Rust error code', async () => {
    api.verb('post').mockResolvedValueOnce({ error: { code: 'INVITATION_ALREADY_PENDING' } });
    await expect(
      useMembersStore.getState().inviteMember('org-1', 'new@example.com', 'viewer'),
    ).rejects.toThrow('An invitation is already pending for this email');
  });

  it('updates a member role from the returned member envelope', async () => {
    useMembersStore.setState({ members: [{ id: 'u1', userId: 'u1', name: 'Ada', email: 'ada@example.com', role: 'owner', joinedAt: member.joinedAt }] });
    api.verb('patch').mockResolvedValueOnce({ data: { member: { ...member, role: 'admin' } } });
    await useMembersStore.getState().updateMemberRole('org-1', 'u1', 'admin');
    expect(api.verb('patch')).toHaveBeenCalledWith(
      '/_api/organizations/{organization_id}/members/{user_id}',
      {
        params: {
          path: { organization_id: 'org-1', user_id: 'u1' },
          header: { 'x-csrf-token': 'test-csrf' },
        },
        body: { role: 'admin' },
      },
    );
    expect(useMembersStore.getState().members[0].role).toBe('admin');
  });

  it('does not mutate local state when the last owner cannot be demoted', async () => {
    useMembersStore.setState({ members: [{ id: 'u1', userId: 'u1', name: 'Ada', email: 'ada@example.com', role: 'owner', joinedAt: member.joinedAt }] });
    api.verb('patch').mockResolvedValueOnce({ error: { code: 'LAST_OWNER' } });
    await expect(useMembersStore.getState().updateMemberRole('org-1', 'u1', 'admin')).rejects.toThrow(
      "Can't remove or demote the last owner",
    );
    expect(useMembersStore.getState().members[0].role).toBe('owner');
  });

  it('removes a member only after the server accepts the mutation', async () => {
    useMembersStore.setState({ members: [{ id: 'u1', userId: 'u1', name: 'Ada', email: 'ada@example.com', role: 'viewer', joinedAt: member.joinedAt }] });
    api.verb('delete').mockResolvedValueOnce({});
    await useMembersStore.getState().removeMember('org-1', 'u1');
    expect(useMembersStore.getState().members).toEqual([]);
  });
});
