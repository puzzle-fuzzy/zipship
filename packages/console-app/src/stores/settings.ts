import { useLocalStorage, type Serializer, type UseStorageOptions } from '@vueuse/core';
import { defineStore } from 'pinia';
import { ref, watch } from 'vue';

export const THEMES = ['day', 'night'] as const;
export type Theme = (typeof THEMES)[number];

export const LANGUAGES = ['zh', 'en'] as const;
export type Language = (typeof LANGUAGES)[number];

const themeSerializer = createValidatedSerializer(THEMES, 'day');
const languageSerializer = createValidatedSerializer(LANGUAGES, 'zh');

const validatedThemeOptions: UseStorageOptions<Theme> = {
  flush: 'sync',
  serializer: themeSerializer,
  writeDefaults: false,
};

const validatedLanguageOptions: UseStorageOptions<Language> = {
  flush: 'sync',
  serializer: languageSerializer,
  writeDefaults: false,
};

export const useSettingsStore = defineStore('settings', () => {
  const theme = useLocalStorage<Theme>('zipship_theme', 'day', validatedThemeOptions);
  const language = useLocalStorage<Language>(
    'zipship_language',
    'zh',
    validatedLanguageOptions,
  );
  const initialized = ref(false);

  watch(
    theme,
    (value) => {
      document.documentElement.classList.toggle('night', value === 'night');
    },
    { flush: 'sync', immediate: true },
  );

  function init(): void {
    initialized.value = true;
  }

  function setTheme(value: Theme): void {
    theme.value = value;
  }

  function setLanguage(value: Language): void {
    language.value = value;
  }

  return {
    theme,
    language,
    initialized,
    init,
    setTheme,
    setLanguage,
  };
});

function createValidatedSerializer<const T extends string>(
  allowedValues: readonly T[],
  fallback: T,
): Serializer<T> {
  return {
    read(rawValue) {
      return allowedValues.some((value) => value === rawValue) ? (rawValue as T) : fallback;
    },
    write(value) {
      return value;
    },
  };
}
