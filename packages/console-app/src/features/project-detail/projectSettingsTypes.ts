export interface ProjectSettingsSaveInput {
  name?: string;
  slug?: string;
  description?: string | null;
  spaFallback?: boolean;
  cachePolicy?: 'standard' | 'aggressive';
}
