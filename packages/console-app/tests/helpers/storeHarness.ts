import type { ApiClient } from '@zipship/api-client';
import type { RuntimeAdapter } from '@zipship/runtime';
import {
  createPinia,
  disposePinia,
  getActivePinia,
  setActivePinia,
  type Pinia,
} from 'pinia';
import { createApp, type App } from 'vue';
import {
  consoleAppContextKey,
  createConsoleAppContext,
  type ConsoleAppContext,
} from '../../src/app/context';

export interface StoreHarnessOptions {
  api?: ApiClient;
  apiBaseUrl?: string;
  context?: ConsoleAppContext;
  runtime?: RuntimeAdapter;
  runtimeKind?: RuntimeAdapter['kind'];
}

export interface StoreHarness {
  app: App;
  context: ConsoleAppContext;
  pinia: Pinia;
  dispose(): void;
  runWithContext<T>(callback: () => T): T;
}

export function createStoreHarness(options: StoreHarnessOptions = {}): StoreHarness {
  const app = createApp({});
  const pinia = createPinia();
  const runtime = options.runtime ?? createTestRuntime(options.runtimeKind);
  const context = options.context ?? createConsoleAppContext({
    apiBaseUrl: options.apiBaseUrl ?? 'http://localhost:3001',
    runtime,
    api: options.api,
  });

  app.use(pinia);
  app.provide(consoleAppContextKey, context);
  setActivePinia(pinia);
  let disposed = false;

  return {
    app,
    context,
    pinia,
    dispose() {
      if (disposed) {
        return;
      }

      disposed = true;
      context.dispose();
      disposePinia(pinia);
      if (getActivePinia() === pinia) {
        setActivePinia(undefined);
      }
    },
    runWithContext: (callback) => app.runWithContext(callback),
  };
}

function createTestRuntime(kind: RuntimeAdapter['kind'] = 'web'): RuntimeAdapter {
  return {
    kind,
    async openExternal() {},
  };
}
