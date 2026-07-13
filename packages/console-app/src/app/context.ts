import { createApiClient, type ApiClient } from '@zipship/api-client';
import type { RuntimeAdapter } from '@zipship/runtime';
import { useSessionStorage, type RemovableRef } from '@vueuse/core';
import { effectScope, inject, type InjectionKey } from 'vue';

export type AuthorizationHeaders = { authorization: string } | Record<string, never>;

export interface ConsoleAppContext {
  api: ApiClient;
  apiBaseUrl: string;
  runtime: RuntimeAdapter;
  sessionToken: RemovableRef<string | null>;
  authHeaders(): AuthorizationHeaders;
  dispose(): void;
}

export interface CreateConsoleAppContextOptions {
  apiBaseUrl: string;
  runtime: RuntimeAdapter;
  api?: ApiClient;
}

export const consoleAppContextKey: InjectionKey<ConsoleAppContext> = Symbol('ConsoleAppContext');

export function createConsoleAppContext(
  options: CreateConsoleAppContextOptions,
): ConsoleAppContext {
  const scope = effectScope(true);
  const sessionToken = scope.run(() => {
    // VueUse composables are valid inside this Vue effect scope; the temporary
    // React lint rules cannot distinguish them during the dual-stack phase.
    // oxlint-disable-next-line react/rules-of-hooks
    return useSessionStorage<string | null>('zipship_refresh_token', null, {
      writeDefaults: false,
    });
  });
  let disposed = false;

  if (!sessionToken) {
    scope.stop();
    throw new Error('Failed to initialize console app context');
  }

  return {
    api: options.api ?? createApiClient(options.apiBaseUrl),
    apiBaseUrl: options.apiBaseUrl,
    runtime: options.runtime,
    sessionToken,
    authHeaders(): AuthorizationHeaders {
      if (!sessionToken.value) {
        return {};
      }

      return { authorization: `Bearer ${sessionToken.value}` };
    },
    dispose() {
      if (disposed) {
        return;
      }

      disposed = true;
      scope.stop();
    },
  };
}

export function useConsoleAppContext(): ConsoleAppContext {
  const context = inject(consoleAppContextKey, null);

  if (!context) {
    throw new Error('Console app context is not installed');
  }

  return context;
}
