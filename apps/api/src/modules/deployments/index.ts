import { Elysia } from "elysia";
import { deploymentModels, DeploymentServiceError } from "./model";
import { DeploymentsService } from "./service";
import type { DeploymentsRepository } from "./service";

export interface DeploymentsModuleOptions {
  repository: DeploymentsRepository;
  hashRefreshToken: (token: string) => Promise<string>;
}

export function deploymentsModule(options: DeploymentsModuleOptions) {
  const deployments = new DeploymentsService({
    repository: options.repository,
    hashRefreshToken: options.hashRefreshToken,
    now: () => new Date(),
  });

  return new Elysia({ name: "deployments", prefix: "/_api/projects/:projectId" })
    .model(deploymentModels)
    .onError(({ code, status }) => {
      if (code === "VALIDATION") {
        return status(400, { code: "VALIDATION_ERROR" as const });
      }
    })
    .post(
      "/releases/:releaseId/publish",
      async ({ headers, params, body, status }) => {
        const result = await deployments.publish(headers, params, body);
        if (result instanceof DeploymentServiceError) {
          return status(toStatusCode(result.code), { code: result.code });
        }
        return result;
      },
      {
        headers: "Deployments.Headers",
        params: "Deployments.ReleaseParams",
        body: "Deployments.Body",
        response: {
          200: "Deployments.Result",
          400: "Deployments.Error",
          401: "Deployments.Error",
          403: "Deployments.Error",
          404: "Deployments.Error",
          409: "Deployments.Error",
        },
      },
    )
    .post(
      "/releases/:releaseId/rollback",
      async ({ headers, params, body, status }) => {
        const result = await deployments.rollback(headers, params, body);
        if (result instanceof DeploymentServiceError) {
          return status(toStatusCode(result.code), { code: result.code });
        }
        return result;
      },
      {
        headers: "Deployments.Headers",
        params: "Deployments.ReleaseParams",
        body: "Deployments.Body",
        response: {
          200: "Deployments.Result",
          400: "Deployments.Error",
          401: "Deployments.Error",
          403: "Deployments.Error",
          404: "Deployments.Error",
          409: "Deployments.Error",
        },
      },
    )
    .get(
      "/deployments",
      async ({ headers, params, status }) => {
        const result = await deployments.list(headers, params);
        if (result instanceof DeploymentServiceError) {
          return status(toGetStatusCode(result.code), { code: result.code });
        }
        return result;
      },
      {
        headers: "Deployments.Headers",
        params: "Deployments.ProjectParams",
        response: {
          200: "Deployments.List",
          400: "Deployments.Error",
          401: "Deployments.Error",
          403: "Deployments.Error",
          404: "Deployments.Error",
        },
      },
    );
}

function toStatusCode(code: string): 401 | 403 | 404 | 409 {
  if (code === "UNAUTHORIZED") return 401;
  if (code === "FORBIDDEN") return 403;
  if (code === "PROJECT_NOT_FOUND" || code === "RELEASE_NOT_FOUND") return 404;
  return 409;
}

function toGetStatusCode(code: string): 401 | 403 | 404 {
  if (code === "UNAUTHORIZED") return 401;
  if (code === "FORBIDDEN") return 403;
  return 404;
}
