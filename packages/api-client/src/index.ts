import createClient from "openapi-fetch";
import type { ClientOptions } from "openapi-fetch";
import type { paths } from "./generated/schema";

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
