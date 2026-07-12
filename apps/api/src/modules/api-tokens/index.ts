import { Elysia } from "elysia";
import { apiTokenModels } from "./model";
import { ApiTokensService, type ApiTokensRepository } from "./service";
import { ApiTokensServiceError } from "./service";
import type { AuthRepository } from "../auth/service";

export interface ApiTokensModuleOptions {
  sessionRepository: Pick<AuthRepository, "findSessionByRefreshTokenHash">;
  apiTokensRepository: ApiTokensRepository;
  hashRefreshToken: (token: string) => Promise<string>;
  hashToken: (token: string) => Promise<string>;
  randomToken: () => string;
}

export function apiTokensModule(options: ApiTokensModuleOptions) {
  const service = new ApiTokensService({
    sessionRepository: options.sessionRepository,
    apiTokensRepository: options.apiTokensRepository,
    hashRefreshToken: options.hashRefreshToken,
    hashToken: options.hashToken,
    randomToken: options.randomToken,
    now: () => new Date(),
  });

  return new Elysia({ name: "api-tokens-module", prefix: "/_api/tokens" })
    .model(apiTokenModels)
    .onError(({ code, status }) => {
      if (code === "VALIDATION") return status(400, { code: "VALIDATION_ERROR" as const });
    })
    .post(
      "/",
      async ({ headers, body, status: setStatus }) => {
        const result = await service.create(headers as any, body as any);
        if (result instanceof ApiTokensServiceError) return setStatus(401, { code: result.code as "UNAUTHORIZED" });
        return result;
      },
      {
        headers: "ApiToken.Headers",
        body: "ApiToken.CreateBody",
        response: {
          200: "ApiToken.Created",
          401: "ApiToken.Error",
        },
      },
    )
    .get(
      "/",
      async ({ headers, status: setStatus }) => {
        const result = await service.list(headers as any);
        if (result instanceof ApiTokensServiceError) return setStatus(401, { code: result.code as "UNAUTHORIZED" });
        return result;
      },
      {
        headers: "ApiToken.Headers",
        response: {
          200: "ApiToken.List",
          401: "ApiToken.Error",
        },
      },
    )
    .delete(
      "/:tokenId",
      async ({ headers, params, status: setStatus }) => {
        const result = await service.revoke(headers as any, params.tokenId);
        if (result instanceof ApiTokensServiceError) {
          const code = result.code as "UNAUTHORIZED" | "NOT_FOUND";
          return setStatus(code === "NOT_FOUND" ? 404 : 401, { code });
        }
        return result;
      },
      {
        headers: "ApiToken.Headers",
        response: {
          200: "ApiToken.Ok",
          401: "ApiToken.Error",
          404: "ApiToken.Error",
        },
      },
    );
}

export { ApiTokensService } from "./service";
export type { ApiTokensRepository } from "./service";
