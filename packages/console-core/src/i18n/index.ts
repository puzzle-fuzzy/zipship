import { useSettingsStore, type Language } from '../stores/settingsStore';
import { en } from './en';
import { zh } from './zh';

type TranslationMap = typeof en;
const locales: Record<Language, TranslationMap> = { zh, en };

function resolvePath(obj: any, path: string): string {
  return path.split('.').reduce((acc, key) => acc?.[key], obj) as string;
}

function interpolate(text: string, params?: Record<string, string | number>): string {
  if (!params) return text;
  return text.replace(/\{\{(\w+)\}\}/g, (_, key) => String(params[key] ?? `{{${key}}}`));
}

export function useTranslation() {
  const language = useSettingsStore((s) => s.language);

  function t(key: string, params?: Record<string, string | number>): string {
    const text = resolvePath(locales[language], key);
    if (text === undefined) return key;
    return interpolate(text, params);
  }

  return { t, language };
}
