import { Elysia } from "elysia";
import { uploadModels, UploadServiceError } from "./model";
import { UploadsService } from "./service";
import type { UploadsRepository } from "./service";

export interface UploadsModuleOptions {
  repository: UploadsRepository;
  hashRefreshToken: (token: string) => Promise<string>;
}

export function uploadsModule(options: UploadsModuleOptions) {
  const uploads = new UploadsService({
    repository: options.repository,
    hashRefreshToken: options.hashRefreshToken,
    now: () => new Date(),
  });

  return new Elysia({ name: "uploads", prefix: "/_api/projects/:projectId/uploads" })
    .model(uploadModels)
    .onError(({ code, status }) => {
      if (code === "VALIDATION") {
        return status(400, { code: "VALIDATION_ERROR" as const });
      }
    })
    .post(
      "/",
      async ({ body, headers, params, status }) => {
        const result = await uploads.create(headers, params, body);

        if (result instanceof UploadServiceError) {
          return status(toStatusCode(result.code), { code: result.code });
        }

        return status(201, result);
      },
      {
        headers: "Uploads.Headers",
        params: "Uploads.Params",
        body: "Uploads.CreateBody",
        response: {
          201: "Uploads.CreateSuccess",
          400: "Uploads.Error",
          401: "Uploads.Error",
          403: "Uploads.Error",
          404: "Uploads.Error",
        },
      },
    );
}

export function uploadDetailsModule(options: UploadsModuleOptions) {
  const uploads = new UploadsService({
    repository: options.repository,
    hashRefreshToken: options.hashRefreshToken,
    now: () => new Date(),
  });

  return new Elysia({ name: "upload-details", prefix: "/_api/uploads/:uploadTaskId" })
    .model(uploadModels)
    .get(
      "/",
      async ({ headers, params, status }) => {
        const result = await uploads.get(headers, params);

        if (result instanceof UploadServiceError) {
          return status(toDetailStatusCode(result.code), { code: result.code });
        }

        return result;
      },
      {
        headers: "Uploads.Headers",
        params: "Uploads.DetailParams",
        response: {
          200: "Uploads.Detail",
          401: "Uploads.Error",
          403: "Uploads.Error",
          404: "Uploads.Error",
        },
      },
    );
}

function toStatusCode(code: string): 400 | 401 | 403 | 404 {
  if (code === "UNAUTHORIZED") return 401;
  if (code === "FORBIDDEN") return 403;
  if (code === "PROJECT_NOT_FOUND") return 404;
  return 400;
}

function toDetailStatusCode(code: string): 401 | 403 | 404 {
  if (code === "UNAUTHORIZED") return 401;
  if (code === "FORBIDDEN") return 403;
  return 404;
}
