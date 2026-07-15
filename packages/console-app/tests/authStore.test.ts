import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockApi, type MockApi } from './helpers/mockApi';
import { getThrownApiErrorCode } from '../src/api/errors';

const { mockApi, setMockApi } = vi.hoisted(() => {
  let current: unknown;
  return {
    mockApi: () => current,
    setMockApi: (api: unknown) => {
      current = api;
    },
  };
});

vi.mock('../src/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/api/client')>();
  return { ...actual, getApi: () => mockApi() };
});

const { useAuthStore } = await import('../src/stores/authStore');

let api: MockApi;
const user = { id: 'u1', displayName: 'Ada', email: 'ada@example.com' };

beforeEach(() => {
  api = createMockApi();
  setMockApi(api._api);
  document.cookie = 'zipship_csrf=test-csrf; Path=/';
  useAuthStore.setState({ status: 'loading', user: null });
});

describe('authStore', () => {
  it('restores a server-side cookie session', async () => {
    api.verb('get').mockResolvedValueOnce({ data: { user } });

    await useAuthStore.getState().initSession();

    expect(api.verb('get')).toHaveBeenCalledWith('/_api/auth/me');
    expect(useAuthStore.getState()).toMatchObject({
      status: 'authenticated',
      user: { id: 'u1', name: 'Ada', email: 'ada@example.com' },
    });
  });

  it('moves to the signed-out boundary when no session is present', async () => {
    api.verb('get').mockResolvedValueOnce({ error: { code: 'UNAUTHENTICATED' } });
    await useAuthStore.getState().initSession();
    expect(useAuthStore.getState()).toMatchObject({ status: 'login', user: null });
  });

  it('logs in without exposing or persisting a bearer token', async () => {
    api.verb('post').mockResolvedValueOnce({ data: { user } });

    await useAuthStore.getState().login('ada@example.com', 'correct horse battery');

    expect(api.verb('post')).toHaveBeenCalledWith('/_api/auth/login', {
      body: { email: 'ada@example.com', password: 'correct horse battery' },
    });
    expect(useAuthStore.getState().status).toBe('authenticated');
    expect(sessionStorage.length).toBe(0);
  });

  it('retains stable login error codes for localized UI messages', async () => {
    api.verb('post').mockResolvedValueOnce({ error: { code: 'INVALID_CREDENTIALS' } });
    const promise = useAuthStore.getState().login('ada@example.com', 'wrong password');
    await expect(promise).rejects.toThrow('Invalid email or password');
    await promise.catch((error) => expect(getThrownApiErrorCode(error)).toBe('INVALID_CREDENTIALS'));
  });

  it('registers with the Rust displayName contract', async () => {
    api.verb('post').mockResolvedValueOnce({ data: { user } });
    await useAuthStore.getState().register('Ada', 'ada@example.com', 'correct horse battery');
    expect(api.verb('post')).toHaveBeenCalledWith('/_api/auth/register', {
      body: { displayName: 'Ada', email: 'ada@example.com', password: 'correct horse battery' },
    });
    expect(useAuthStore.getState().status).toBe('authenticated');
  });

  it('logs out with CSRF protection before clearing local user state', async () => {
    useAuthStore.setState({ status: 'authenticated', user: { id: 'u1', name: 'Ada', email: 'ada@example.com' } });
    api.verb('post').mockResolvedValueOnce({});

    await useAuthStore.getState().logout();

    expect(api.verb('post')).toHaveBeenCalledWith('/_api/auth/logout', {
      params: { header: { 'x-csrf-token': 'test-csrf' } },
    });
    expect(useAuthStore.getState()).toMatchObject({ status: 'login', user: null });
  });

  it('updates the profile through the CSRF-protected Rust route', async () => {
    useAuthStore.setState({ status: 'authenticated', user: { id: 'u1', name: 'Ada', email: 'ada@example.com' } });
    api.verb('patch').mockResolvedValueOnce({ data: { user: { ...user, displayName: 'Ada Lovelace' } } });
    await useAuthStore.getState().updateProfile('Ada Lovelace');
    expect(api.verb('patch')).toHaveBeenCalledWith('/_api/auth/me', {
      params: { header: { 'x-csrf-token': 'test-csrf' } },
      body: { displayName: 'Ada Lovelace' },
    });
    expect(useAuthStore.getState().user?.name).toBe('Ada Lovelace');
  });

  it('requests recovery with the non-enumerating public route', async () => {
    api.verb('post').mockResolvedValueOnce({});
    await useAuthStore.getState().requestPasswordReset('ada@example.com');
    expect(api.verb('post')).toHaveBeenCalledWith('/_api/auth/password-resets', {
      body: { email: 'ada@example.com' },
    });
  });

  it('confirms recovery and returns to a signed-out state', async () => {
    useAuthStore.setState({ status: 'authenticated', user: { id: 'u1', name: 'Ada', email: 'ada@example.com' } });
    api.verb('post').mockResolvedValueOnce({});
    await useAuthStore.getState().confirmPasswordReset('secret-token', 'correct horse battery');
    expect(api.verb('post')).toHaveBeenCalledWith('/_api/auth/password-resets/confirm', {
      body: { token: 'secret-token', password: 'correct horse battery' },
    });
    expect(useAuthStore.getState()).toMatchObject({ status: 'login', user: null });
  });
});
