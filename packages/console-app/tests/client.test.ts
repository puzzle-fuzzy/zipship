import { beforeEach, describe, expect, it } from 'vitest';
import { getApi, getApiBaseUrl, getCsrfHeaders } from '../src/api/client';

describe('Rust API client boundary', () => {
  beforeEach(() => {
    document.cookie = 'zipship_csrf=; Max-Age=0; Path=/';
    window.__ZIPSHIP_API_BASE_URL = undefined;
  });

  it('reads the shell-injected API base URL', () => {
    window.__ZIPSHIP_API_BASE_URL = 'http://api.test';
    expect(getApiBaseUrl()).toBe('http://api.test');
  });

  it('falls back to a same-origin base URL', () => {
    expect(getApiBaseUrl()).toBe('');
  });

  it('builds mutation headers from the CSRF cookie', () => {
    document.cookie = 'zipship_csrf=csrf%20value; Path=/';
    expect(getCsrfHeaders()).toEqual({ 'x-csrf-token': 'csrf value' });
  });

  it('fails closed when the CSRF cookie is absent', () => {
    expect(() => getCsrfHeaders()).toThrow('CSRF token cookie is missing');
  });

  it('reuses one cookie-authenticated OpenAPI client', () => {
    expect(getApi()).toBe(getApi());
  });
});
