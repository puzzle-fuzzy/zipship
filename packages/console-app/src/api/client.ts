import {
  createApiClient,
  csrfHeaders,
  type ApiClient,
} from "@zipship/api-client";

type ZipShipRuntimeWindow = Window & {
  __ZIPSHIP_API_BASE_URL?: string;
  __ZIPSHIP_ACCESS_BASE_URL?: string;
};

/** Base URL injected by the web or desktop shell before the first API call. */
export function getApiBaseUrl(): string {
  if (typeof window === "undefined") return "";
  return (window as ZipShipRuntimeWindow).__ZIPSHIP_API_BASE_URL ?? "";
}

/** Independent-origin base URL for immutable previews and live project traffic. */
export function getAccessPlaneBaseUrl(): string {
  if (typeof window === "undefined") return "";
  return (window as ZipShipRuntimeWindow).__ZIPSHIP_ACCESS_BASE_URL ?? "";
}

let client: ApiClient | null = null;

/**
 * The Console uses the Rust OpenAPI contract exclusively. Authentication is
 * carried by hardened browser cookies, never JavaScript-readable bearer tokens.
 */
export function getApi(): ApiClient {
  client ??= createApiClient(getApiBaseUrl());
  return client;
}

/** Read the non-HttpOnly CSRF cookie for authenticated state-changing calls. */
export function getCsrfHeaders(): { "x-csrf-token": string } {
  return csrfHeaders();
}
