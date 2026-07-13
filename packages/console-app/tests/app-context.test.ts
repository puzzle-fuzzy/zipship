import { createApp, nextTick } from 'vue';
import type { ApiClient } from '@zipship/api-client';
import type { RuntimeAdapter } from '@zipship/runtime';
import { getActivePinia } from 'pinia';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  consoleAppContextKey,
  createConsoleAppContext,
  type ConsoleAppContext,
  type CreateConsoleAppContextOptions,
  useConsoleAppContext,
} from '../src/app/context';
import { createMockApi } from './helpers/mockApi';
import {
  createStoreHarness,
  type StoreHarness,
  type StoreHarnessOptions,
} from './helpers/storeHarness';

const runtime: RuntimeAdapter = {
  kind: 'web',
  openExternal: vi.fn(async () => undefined),
};

let contexts: ConsoleAppContext[] = [];
let harnesses: StoreHarness[] = [];

afterEach(() => {
  for (const harness of harnesses) {
    harness.dispose();
  }
  for (const context of contexts) {
    context.dispose();
  }
  harnesses = [];
  contexts = [];
});

function createTestApi(): ApiClient {
  return createMockApi() as unknown as ApiClient;
}

function createTestContext(
  options: Partial<CreateConsoleAppContextOptions> = {},
): ConsoleAppContext {
  const context = createConsoleAppContext({
    apiBaseUrl: options.apiBaseUrl ?? 'http://one',
    runtime: options.runtime ?? runtime,
    api: options.api,
  });
  contexts.push(context);
  return context;
}

function createTestStoreHarness(options: StoreHarnessOptions = {}): StoreHarness {
  const harness = createStoreHarness(options);
  harnesses.push(harness);
  return harness;
}

describe('console app context', () => {
  it('creates an isolated API client for each context', () => {
    const first = createTestContext({ apiBaseUrl: 'http://one' });
    const second = createTestContext({ apiBaseUrl: 'http://two' });

    expect(first.api).not.toBe(second.api);
    expect(first.apiBaseUrl).toBe('http://one');
    expect(second.apiBaseUrl).toBe('http://two');
  });

  it('uses an explicitly injected API client', () => {
    const api = createTestApi();

    expect(createTestContext({ api }).api).toBe(api);
  });

  it('builds authorization headers from the context token', async () => {
    const context = createTestContext({
      api: createTestApi(),
    });

    expect(context.authHeaders()).toEqual({});
    context.sessionToken.value = 'token-1';
    expect(context.authHeaders()).toEqual({ authorization: 'Bearer token-1' });
    await nextTick();
    expect(sessionStorage.getItem('zipship_refresh_token')).toBe('token-1');
  });

  it('stops same-key storage synchronization after disposal', async () => {
    const active = createTestContext({ api: createTestApi() });
    const disposed = createTestContext({ api: createTestApi() });

    active.sessionToken.value = 'before-dispose';
    await nextTick();
    expect(disposed.sessionToken.value).toBe('before-dispose');

    disposed.dispose();
    active.sessionToken.value = 'after-dispose';
    await nextTick();

    expect(disposed.sessionToken.value).toBe('before-dispose');
    expect(sessionStorage.getItem('zipship_refresh_token')).toBe('after-dispose');
    expect(() => disposed.dispose()).not.toThrow();
  });

  it('returns the context installed on the current Vue app', () => {
    const app = createApp({});
    const context = createTestContext({
      api: createTestApi(),
    });
    app.provide(consoleAppContextKey, context);

    expect(app.runWithContext(() => useConsoleAppContext())).toBe(context);
  });

  it('throws a stable error when the context is not installed', () => {
    const app = createApp({});

    expect(() => app.runWithContext(() => useConsoleAppContext())).toThrow(
      'Console app context is not installed',
    );
  });

  it('disposes the context and active Pinia through the store harness', () => {
    const harness = createTestStoreHarness({ api: createTestApi() });
    const contextDispose = vi.spyOn(harness.context, 'dispose');

    expect(getActivePinia()).toBe(harness.pinia);
    harness.dispose();
    harness.dispose();

    expect(contextDispose).toHaveBeenCalledTimes(1);
    expect(getActivePinia()).toBeUndefined();
  });
});
