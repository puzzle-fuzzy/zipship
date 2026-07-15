import { getThrownApiErrorCode } from "../../api/errors";

export function formatTokenDate(value: string, language: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(language === "zh" ? "zh-CN" : "en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function tokenErrorMessage(
  error: unknown,
  t: (key: string, params?: Record<string, string | number>) => string,
  fallbackKey: string,
): string {
  const code = getThrownApiErrorCode(error);
  const key = code
    ? {
        UNAUTHENTICATED: "settings.apiTokenErrors.unauthenticated",
        INVALID_CSRF_TOKEN: "settings.apiTokenErrors.csrf",
        INVALID_API_TOKEN_NAME: "settings.apiTokenErrors.name",
        INVALID_API_TOKEN_SCOPES: "settings.apiTokenErrors.scopes",
        INVALID_API_TOKEN_EXPIRATION: "settings.apiTokenErrors.expiration",
        API_TOKEN_LIMIT_REACHED: "settings.apiTokenErrors.limit",
        API_TOKEN_NOT_FOUND: "settings.apiTokenErrors.notFound",
      }[code]
    : undefined;
  return t(key ?? fallbackKey);
}
