import createClient from "openapi-fetch";
import type { ClientOptions } from "openapi-fetch";
import type { paths } from "./generated/schema";

export const CSRF_COOKIE_NAME = "zipship_csrf";

export function createApiClient(
  baseUrl: string,
  options: Omit<ClientOptions, "baseUrl"> = {},
) {
  return createClient<paths>({
    ...options,
    baseUrl: baseUrl.replace(/\/$/, ""),
    credentials: options.credentials ?? "include",
  });
}

export type ApiClient = ReturnType<typeof createApiClient>;
export type { components, operations, paths } from "./generated/schema";

export function readCsrfToken(
  cookieHeader = typeof document === "undefined" ? "" : document.cookie,
): string | null {
  for (const cookie of cookieHeader.split(";")) {
    const [name, ...value] = cookie.trim().split("=");
    if (name === CSRF_COOKIE_NAME) {
      return decodeURIComponent(value.join("="));
    }
  }
  return null;
}

export function csrfHeaders(cookieHeader?: string): {
  "x-csrf-token": string;
} {
  const token = readCsrfToken(cookieHeader);
  if (!token) {
    throw new Error("CSRF token cookie is missing");
  }
  return { "x-csrf-token": token };
}
