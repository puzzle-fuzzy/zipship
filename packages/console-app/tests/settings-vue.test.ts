import { afterEach, describe, expect, it } from 'vitest';
import { useSettingsStore } from '../src/stores/settings';
import { createStoreHarness, type StoreHarness } from './helpers/storeHarness';

let harnesses: StoreHarness[] = [];

afterEach(() => {
  for (const harness of harnesses) {
    harness.dispose();
  }
  harnesses = [];
  document.documentElement.classList.remove('night');
});

function createSettingsStore() {
  const harness = createStoreHarness();
  harnesses.push(harness);
  // Vue setup store, not a React hook; the dual-stack lint rules cannot distinguish it.
  // oxlint-disable-next-line react/rules-of-hooks
  return useSettingsStore(harness.pinia);
}

describe('Vue settings store', () => {
  it('defaults to day and Chinese settings', () => {
    const store = createSettingsStore();

    store.init();

    expect(store.theme).toBe('day');
    expect(store.language).toBe('zh');
    expect(store.initialized).toBe(true);
    expect(document.documentElement).not.toHaveClass('night');
  });

  it('restores valid persisted settings and applies the theme', () => {
    localStorage.setItem('zipship_theme', 'night');
    localStorage.setItem('zipship_language', 'en');

    const store = createSettingsStore();
    store.init();

    expect(store.theme).toBe('night');
    expect(store.language).toBe('en');
    expect(document.documentElement).toHaveClass('night');
  });

  it('falls back from invalid persisted settings', () => {
    localStorage.setItem('zipship_theme', 'broken');
    localStorage.setItem('zipship_language', 'broken');

    const store = createSettingsStore();
    store.init();

    expect(store.theme).toBe('day');
    expect(store.language).toBe('zh');
    expect(document.documentElement).not.toHaveClass('night');
  });

  it('persists setters and reacts to theme changes', () => {
    const store = createSettingsStore();

    store.setTheme('night');
    store.setLanguage('en');

    expect(localStorage.getItem('zipship_theme')).toBe('night');
    expect(localStorage.getItem('zipship_language')).toBe('en');
    expect(document.documentElement).toHaveClass('night');

    store.setTheme('day');
    expect(document.documentElement).not.toHaveClass('night');
  });
});
