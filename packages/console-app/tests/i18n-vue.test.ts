import { afterEach, describe, expect, it } from 'vitest';
import { en } from '../src/i18n/en';
import { useTranslation } from '../src/i18n/useTranslation';
import { zh } from '../src/i18n/zh';
import { useSettingsStore } from '../src/stores/settings';
import { createStoreHarness, type StoreHarness } from './helpers/storeHarness';

let harnesses: StoreHarness[] = [];

afterEach(() => {
  for (const harness of harnesses) {
    harness.dispose();
  }
  harnesses = [];
});

function createTranslationHarness() {
  const harness = createStoreHarness();
  harnesses.push(harness);
  // Vue setup store, not a React hook; the dual-stack lint rules cannot distinguish it.
  // oxlint-disable-next-line react/rules-of-hooks
  const settings = useSettingsStore(harness.pinia);
  const translation = harness.runWithContext(() => useTranslation());
  return { settings, ...translation };
}

function flattenLeaves(
  value: unknown,
  prefix = '',
  result: Map<string, string> = new Map(),
): Map<string, string> {
  if (typeof value === 'string') {
    result.set(prefix, value);
    return result;
  }

  if (!isRecord(value)) {
    throw new TypeError(`Translation at "${prefix}" must be a string or object`);
  }

  for (const [key, child] of Object.entries(value)) {
    flattenLeaves(child, prefix ? `${prefix}.${key}` : key, result);
  }
  return result;
}

function placeholders(value: string): string[] {
  return [...value.matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1]).sort();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

describe('Vue translation composable', () => {
  it('translates reactively after changing language', () => {
    const { settings, t, language } = createTranslationHarness();
    const zhTitle = t('projects.title');

    settings.setLanguage('en');

    expect(t('projects.title')).not.toBe(zhTitle);
    expect(t('projects.title')).toBe(en.projects.title);
    expect(language.value).toBe('en');
  });

  it('interpolates known parameters and preserves missing placeholders', () => {
    const { t } = createTranslationHarness();

    expect(t('versions.files', { count: 7 })).toBe('7 个文件');
    expect(t('versions.size')).toBe('{{size}} KB');
  });

  it('returns an unknown key unchanged', () => {
    const { t } = createTranslationHarness();

    expect(t('missing.deep.key')).toBe('missing.deep.key');
  });

  it('keeps all leaf keys and interpolation placeholders in dictionary parity', () => {
    const enLeaves = flattenLeaves(en);
    const zhLeaves = flattenLeaves(zh);

    expect([...zhLeaves.keys()].sort()).toEqual([...enLeaves.keys()].sort());

    for (const [key, english] of enLeaves) {
      expect(placeholders(zhLeaves.get(key) ?? ''), key).toEqual(placeholders(english));
    }
  });
});
