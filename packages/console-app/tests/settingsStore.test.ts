import { beforeEach, describe, expect, it } from 'vitest';
import { useSettingsStore } from '../src/stores/settingsStore';

beforeEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove('night');
  useSettingsStore.setState({
    theme: 'day',
    language: 'zh',
    initialized: false,
  });
});

describe('settingsStore.init', () => {
  it('defaults to day/zh when nothing is saved', () => {
    useSettingsStore.getState().init();
    const s = useSettingsStore.getState();
    expect(s.theme).toBe('day');
    expect(s.language).toBe('zh');
    expect(s.initialized).toBe(true);
    expect(document.documentElement.classList.contains('night')).toBe(false);
    expect(document.documentElement.lang).toBe('zh-CN');
  });

  it('restores saved theme and language', () => {
    localStorage.setItem('zipship_theme', 'night');
    localStorage.setItem('zipship_language', 'en');
    useSettingsStore.getState().init();
    const s = useSettingsStore.getState();
    expect(s.theme).toBe('night');
    expect(s.language).toBe('en');
    expect(document.documentElement.classList.contains('night')).toBe(true);
    expect(document.documentElement.lang).toBe('en');
  });
});

describe('settingsStore.setTheme', () => {
  it('persists the theme and toggles the .night class on <html>', () => {
    useSettingsStore.getState().setTheme('night');
    expect(localStorage.getItem('zipship_theme')).toBe('night');
    expect(useSettingsStore.getState().theme).toBe('night');
    expect(document.documentElement.classList.contains('night')).toBe(true);

    useSettingsStore.getState().setTheme('day');
    expect(localStorage.getItem('zipship_theme')).toBe('day');
    expect(document.documentElement.classList.contains('night')).toBe(false);
  });
});

describe('settingsStore.setLanguage', () => {
  it('persists the language and updates the document language', () => {
    useSettingsStore.getState().setLanguage('en');
    expect(localStorage.getItem('zipship_language')).toBe('en');
    expect(useSettingsStore.getState().language).toBe('en');
    expect(document.documentElement.lang).toBe('en');
  });
});
