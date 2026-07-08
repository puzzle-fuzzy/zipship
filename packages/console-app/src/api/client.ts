import { treaty } from "@elysia/eden";
import type { App } from "@zipship/api";

/**
 * API client foundation for the console app.
 *
 * Previously every Zustand store method called `createApiClient(apiBaseUrl)`
 * (13 copies) and read the refresh token from props. This module is the single
 * place that knows how to reach the API and where the session token lives.
 * Stores and services import {@link api}, {@link getAccessToken}, and
 * {@link authHeaders} instead of re-deriving them.
 */

const TOKEN_KEY = "zipship_refresh_token";

/** Base URL injected by the shell (web/desktop) into `window` at boot. */
export function getApiBaseUrl(): string {
  if (typeof window === "undefined") return "";
  return (
    (window as unknown as { __ZIPSHIP_API_BASE_URL?: string })
      .__ZIPSHIP_API_BASE_URL ?? ""
  );
}

// Session token (kept in sessionStorage so it survives reloads).
export function getAccessToken(): string | null {
  if (typeof window === "undefined") return null;
  return sessionStorage.getItem(TOKEN_KEY);
}

export function setAccessToken(token: string): void {
  sessionStorage.setItem(TOKEN_KEY, token);
}

export function clearAccessToken(): void {
  sessionStorage.removeItem(TOKEN_KEY);
}

/** Authorization header for authenticated requests, or `{}` when logged out. */
export function authHeaders(): { authorization: string } | Record<string, never> {
  const token = getAccessToken();
  return token ? { authorization: `Bearer ${token}` } : {};
}

/**
 * Eden Treaty client bound to the shell-injected base URL. Created lazily on
 * first access so the `window` global (set during App render) is available.
 */
let _client: ReturnType<typeof treaty<App>> | null = null;

export function getApi(): ReturnType<typeof treaty<App>> {
  if (!_client) _client = treaty<App>(getApiBaseUrl());
  return _client;
}
