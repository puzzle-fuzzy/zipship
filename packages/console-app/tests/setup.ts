import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach } from 'vitest';

/**
 * Global test setup for the console-app vitest suite.
 *
 * jsdom provides `window`, `document`, `sessionStorage`, and `localStorage`,
 * but NOT the browser APIs the app reaches for at boot. We stub the shell-
 * injected Control/Access base URLs, the missing `matchMedia` (used by the
 * sidebar's mobile hook), and isolate storage between tests so store state and
 * tokens never leak across cases.
 */

// jsdom does not implement matchMedia; polyfill once so any component using the
// sidebar / responsive hooks can render.
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList;
}

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  // The shells inject both independent origins before rendering <App />.
  const runtimeWindow = window as unknown as {
    __ZIPSHIP_API_BASE_URL?: string;
    __ZIPSHIP_ACCESS_BASE_URL?: string;
  };
  runtimeWindow.__ZIPSHIP_API_BASE_URL = 'http://localhost:5006';
  runtimeWindow.__ZIPSHIP_ACCESS_BASE_URL = 'http://localhost:5007';

  localStorage.clear();
  sessionStorage.clear();
});
