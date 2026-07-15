import type { components } from "@zipship/api-client";
import { getApi, getCsrfHeaders } from "../../api/client";
import {
  ApiClientError,
  getApiErrorCode,
  type OpenApiFailure,
} from "../../api/errors";

export type ApiToken = components["schemas"]["ApiTokenResponse"];
export type ApiTokenScope = components["schemas"]["ApiTokenScopeDto"];
export type IssuedApiToken = components["schemas"]["IssuedApiTokenResponse"];

export interface CreateApiTokenInput {
  name: string;
  scopes: ApiTokenScope[];
  expiresInDays: number;
}

export async function listApiTokens(): Promise<ApiToken[]> {
  const result = await getApi().GET("/_api/api-tokens");
  if (result.error || !result.data) {
    throw tokenRequestError(result, "Failed to load API tokens");
  }
  return result.data.apiTokens;
}

export async function createApiToken(
  input: CreateApiTokenInput,
): Promise<IssuedApiToken> {
  const result = await getApi().POST("/_api/api-tokens", {
    params: { header: getCsrfHeaders() },
    body: input,
  });
  if (result.error || !result.data) {
    throw tokenRequestError(result, "Failed to create API token");
  }
  return result.data;
}

export async function revokeApiToken(tokenId: string): Promise<void> {
  const result = await getApi().DELETE("/_api/api-tokens/{token_id}", {
    params: {
      path: { token_id: tokenId },
      header: getCsrfHeaders(),
    },
  });
  if (result.error) {
    throw tokenRequestError(result, "Failed to revoke API token");
  }
}

function tokenRequestError(result: OpenApiFailure, fallback: string): Error {
  return new ApiClientError(fallback, getApiErrorCode(result));
}
