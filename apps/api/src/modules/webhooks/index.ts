import { Elysia } from "elysia";
import { webhookModels } from "./model";
import { WebhookService, WebhookServiceError, type WebhooksRepository } from "./service";
import type { AuthRepository } from "../auth/service";
import type { MemberRole } from "../permissions/model";
import type { PermissionService } from "../permissions/service";

export interface WebhooksModuleOptions {
  repository: WebhooksRepository;
  sessionRepository: Pick<AuthRepository, "findSessionByRefreshTokenHash">;
  organizationsRepository: {
    findMembership(input: { organizationId: string; userId: string }): Promise<{ role: MemberRole } | null>;
  };
  hashRefreshToken: (token: string) => Promise<string>;
  permissions?: PermissionService;
}

export function webhooksModule(options: WebhooksModuleOptions) {
  const service = new WebhookService({
    repository: options.repository,
    sessionRepository: options.sessionRepository,
    organizationsRepository: options.organizationsRepository,
    hashRefreshToken: options.hashRefreshToken,
    now: () => new Date(),
    permissions: options.permissions,
  });

  return new Elysia({ name: "webhooks-module", prefix: "/_api/organizations/:organizationId/webhooks" })
    .model(webhookModels)
    .onError(({ code, status }) => {
      if (code === "VALIDATION") return status(400, { code: "VALIDATION_ERROR" as const });
    })
    .post(
      "/",
      async ({ headers, params, body, status: setStatus }) => {
        const result = await service.create(headers as any, params as any, body as any);
        if (result instanceof WebhookServiceError) {
          if (result.code === "UNAUTHORIZED") return setStatus(401, { code: "UNAUTHORIZED" as const });
          return setStatus(403, { code: "FORBIDDEN" as const });
        }
        return result;
      },
      {
        headers: "Webhook.Headers",
        params: "Webhook.Params",
        body: "Webhook.Body",
        response: {
          200: "Webhook.Item",
          400: "Webhook.Error",
          401: "Webhook.Error",
          403: "Webhook.Error",
        },
      },
    )
    .get(
      "/",
      async ({ headers, params, status: setStatus }) => {
        const result = await service.list(headers as any, params as any);
        if (result instanceof WebhookServiceError) {
          if (result.code === "UNAUTHORIZED") return setStatus(401, { code: "UNAUTHORIZED" as const });
          return setStatus(403, { code: "FORBIDDEN" as const });
        }
        return result;
      },
      {
        headers: "Webhook.Headers",
        params: "Webhook.Params",
        response: {
          200: "Webhook.List",
          401: "Webhook.Error",
          403: "Webhook.Error",
        },
      },
    )
    .delete(
      "/:webhookId",
      async ({ headers, params, status: setStatus }) => {
        const result = await service.revoke(headers as any, params as any);
        if (result instanceof WebhookServiceError) {
          if (result.code === "UNAUTHORIZED") return setStatus(401, { code: "UNAUTHORIZED" as const });
          if (result.code === "FORBIDDEN") return setStatus(403, { code: "FORBIDDEN" as const });
          return setStatus(404, { code: "NOT_FOUND" as const });
        }
        return result;
      },
      {
        headers: "Webhook.Headers",
        params: "Webhook.TargetParams",
        response: {
          200: "Webhook.Ok",
          401: "Webhook.Error",
          403: "Webhook.Error",
          404: "Webhook.Error",
        },
      },
    );
}

export { WebhookService } from "./service";
export type { WebhooksRepository } from "./service";
