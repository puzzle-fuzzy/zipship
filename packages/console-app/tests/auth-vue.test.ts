import type { ApiClient } from '@zipship/api-client';
import { afterEach, describe, expect, it } from 'vitest';
import { useAuthStore } from '../src/stores/auth';
import { createMockApi, type MockApi } from './helpers/mockApi';
import { createStoreHarness, type StoreHarness } from './helpers/storeHarness';

const ada = { id: 'u1', name: 'Ada', email: 'ada@example.com' };
let harnesses: StoreHarness[] = [];

afterEach(() => {
  for (const harness of harnesses) {
    harness.dispose();
  }
  harnesses = [];
});

function createAuthHarness(runtimeKind: 'web' | 'desktop' = 'web') {
  const api = createMockApi();
  const harness = createStoreHarness({
    api: api as unknown as ApiClient,
    runtimeKind,
  });
  harnesses.push(harness);
  const store = harness.runWithContext(() => useAuthStore());
  return { api, context: harness.context, harness, store };
}

function mockSessionSuccess(api: MockApi, token = 'rt-123') {
  api.verb('post').mockResolvedValueOnce({
    data: {
      user: ada,
      session: { refreshToken: token },
    },
    error: null,
  });
}

describe('Vue auth store', () => {
  it.each(['web', 'desktop'] as const)('uses the %s runtime for login', async (runtimeKind) => {
    const { api, context, store } = createAuthHarness(runtimeKind);
    mockSessionSuccess(api);

    await store.login('ada@example.com', 'secret123');

    expect(api.verb('post')).toHaveBeenCalledWith({
      email: 'ada@example.com',
      password: 'secret123',
      clientType: runtimeKind,
    });
    expect(context.sessionToken.value).toBe('rt-123');
    expect(store.status).toBe('authenticated');
    expect(store.user).toEqual(ada);
  });

  it('uses the desktop runtime for registration', async () => {
    const { api, context, store } = createAuthHarness('desktop');
    mockSessionSuccess(api, 'rt-desktop');

    await store.register('Ada', 'ada@example.com', 'secret123');

    expect(api.verb('post')).toHaveBeenCalledWith({
      name: 'Ada',
      email: 'ada@example.com',
      password: 'secret123',
      clientType: 'desktop',
    });
    expect(context.sessionToken.value).toBe('rt-desktop');
    expect(store.status).toBe('authenticated');
  });

  it('maps authentication errors without mutating the session', async () => {
    const { api, context, store } = createAuthHarness();
    api.verb('post').mockResolvedValueOnce({
      data: null,
      error: { status: 401, value: { code: 'INVALID_CREDENTIALS' } },
    });

    await expect(store.login('ada@example.com', 'wrong-password')).rejects.toThrow(
      'Invalid email or password',
    );
    expect(context.sessionToken.value).toBeNull();
    expect(store.status).toBe('loading');
  });

  it('moves directly to login without requesting when no token exists', async () => {
    const { api, store } = createAuthHarness();

    await store.initSession();

    expect(store.status).toBe('login');
    expect(api.verb('get')).not.toHaveBeenCalled();
  });

  it('restores a stored session', async () => {
    const { api, context, store } = createAuthHarness();
    context.sessionToken.value = 'rt-saved';
    api.verb('get').mockResolvedValueOnce({
      data: { user: ada },
      error: null,
    });

    await store.initSession();

    expect(api.verb('get')).toHaveBeenCalledWith({
      headers: { authorization: 'Bearer rt-saved' },
    });
    expect(store.status).toBe('authenticated');
    expect(store.user).toEqual(ada);
  });

  it('clears a stored session rejected by the server', async () => {
    const { api, context, store } = createAuthHarness();
    context.sessionToken.value = 'rt-stale';
    api.verb('get').mockResolvedValueOnce({
      data: null,
      error: { status: 401, value: { code: 'UNAUTHORIZED' } },
    });

    await store.initSession();

    expect(context.sessionToken.value).toBeNull();
    expect(store.status).toBe('login');
    expect(store.user).toBeNull();
  });

  it('clears a stored session after a recovery request fails', async () => {
    const { api, context, store } = createAuthHarness();
    context.sessionToken.value = 'rt-stale';
    api.verb('get').mockRejectedValueOnce(new Error('network down'));

    await store.initSession();

    expect(context.sessionToken.value).toBeNull();
    expect(store.status).toBe('login');
    expect(store.user).toBeNull();
  });

  it('revokes the server session before clearing local state', async () => {
    const { api, context, store } = createAuthHarness();
    context.sessionToken.value = 'rt-active';
    store.status = 'authenticated';
    store.user = ada;
    api.verb('post').mockResolvedValueOnce({ data: { ok: true }, error: null });

    await store.logout();

    expect(api.verb('post')).toHaveBeenCalledWith(undefined, {
      headers: { authorization: 'Bearer rt-active' },
    });
    expect(context.sessionToken.value).toBeNull();
    expect(store.status).toBe('login');
    expect(store.user).toBeNull();
  });

  it('clears local state when server revocation fails', async () => {
    const { api, context, store } = createAuthHarness();
    context.sessionToken.value = 'rt-active';
    store.status = 'authenticated';
    store.user = ada;
    api.verb('post').mockRejectedValueOnce(new Error('network down'));

    await expect(store.logout()).rejects.toThrow('network down');

    expect(context.sessionToken.value).toBeNull();
    expect(store.status).toBe('login');
    expect(store.user).toBeNull();
  });

  it('updates the authenticated user profile', async () => {
    const { api, context, store } = createAuthHarness();
    context.sessionToken.value = 'rt-active';
    store.status = 'authenticated';
    store.user = ada;
    api.verb('patch').mockResolvedValueOnce({
      data: { user: { ...ada, name: 'Ada Lovelace' } },
      error: null,
    });

    await store.updateProfile('Ada Lovelace');

    expect(api.verb('patch')).toHaveBeenCalledWith(
      { name: 'Ada Lovelace' },
      { headers: { authorization: 'Bearer rt-active' } },
    );
    expect(store.user?.name).toBe('Ada Lovelace');
  });

  it('clears session state explicitly', () => {
    const { context, store } = createAuthHarness();
    context.sessionToken.value = 'rt-active';
    store.status = 'authenticated';
    store.user = ada;

    store.clearSession();

    expect(context.sessionToken.value).toBeNull();
    expect(store.status).toBe('login');
    expect(store.user).toBeNull();
  });
});
