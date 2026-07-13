import { computed, type ComputedRef } from 'vue';
import { useSettingsStore, type Language } from '../stores/settings';
import { en } from './en';
import { zh } from './zh';

const locales: Record<Language, unknown> = { zh, en };

export interface TranslationApi {
  t(key: string, params?: Record<string, string | number>): string;
  language: ComputedRef<Language>;
}

export function useTranslation(): TranslationApi {
  const settings = useSettingsStore();

  function t(key: string, params?: Record<string, string | number>): string {
    const text = resolvePath(locales[settings.language], key);
    return interpolate(text ?? key, params);
  }

  return {
    t,
    language: computed(() => settings.language),
  };
}

function resolvePath(value: unknown, path: string): string | undefined {
  let current: unknown = value;

  for (const segment of path.split('.')) {
    if (!isRecord(current) || !(segment in current)) {
      return undefined;
    }
    current = current[segment];
  }

  return typeof current === 'string' ? current : undefined;
}

function interpolate(text: string, params?: Record<string, string | number>): string {
  if (!params) {
    return text;
  }

  return text.replace(/\{\{(\w+)\}\}/g, (placeholder, key: string) => {
    const value = params[key];
    return value === undefined ? placeholder : String(value);
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
