import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach } from 'vitest';

/**
 * Global test setup for the console-app vitest suite.
 *
 * jsdom provides `window`, `document`, `sessionStorage`, and `localStorage`,
 * but NOT the browser APIs the app reaches for at boot. We stub the shell-
 * injected API base URL and isolate storage between tests so store state and
 * tokens never leak across cases.
 */

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  // The shells inject this onto `window` before rendering <App />.
  (window as unknown as { __ZIPSHIP_API_BASE_URL?: string }).__ZIPSHIP_API_BASE_URL =
    'http://localhost:3001';

  localStorage.clear();
  sessionStorage.clear();
});
