import { beforeEach, describe, expect, it } from 'vitest';
import {
  authHeaders,
  clearAccessToken,
  getAccessToken,
  getApi,
  getApiBaseUrl,
  setAccessToken,
} from '../src/api/client';

describe('token storage', () => {
  beforeEach(() => sessionStorage.clear());

  it('round-trips a token through sessionStorage', () => {
    expect(getAccessToken()).toBeNull();
    setAccessToken('rt_secret');
    expect(getAccessToken()).toBe('rt_secret');
    clearAccessToken();
    expect(getAccessToken()).toBeNull();
  });

  it('authHeaders returns a Bearer header when logged in, empty object when not', () => {
    expect(authHeaders()).toEqual({});
    setAccessToken('rt_secret');
    expect(authHeaders()).toEqual({ authorization: 'Bearer rt_secret' });
  });
});

describe('getApiBaseUrl', () => {
  it('reads the shell-injected value from window', () => {
    (window as unknown as { __ZIPSHIP_API_BASE_URL?: string }).__ZIPSHIP_API_BASE_URL =
      'http://api.test';
    expect(getApiBaseUrl()).toBe('http://api.test');
  });

  it('falls back to empty string when unset', () => {
    (window as unknown as { __ZIPSHIP_API_BASE_URL?: string }).__ZIPSHIP_API_BASE_URL = undefined;
    expect(getApiBaseUrl()).toBe('');
  });
});

describe('getApi client cache', () => {
  it('returns the same client instance across calls (created lazily)', () => {
    expect(getApi()).toBe(getApi());
  });
});
