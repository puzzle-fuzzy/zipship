import { Elysia } from "elysia";
import { uploadModels, UploadServiceError } from "./model";
import { UploadsService } from "./service";
import type { UploadsRepository } from "./service";
import type { StoragePaths } from "@zipship/storage";
import { ReleaseProcessingError } from "../release-processing/model";
import { ReleaseProcessingService } from "../release-processing/service";
import type { ReleaseProcessingRepository } from "../release-processing/service";

export interface UploadsModuleOptions {
  repository: UploadsRepository & ReleaseProcessingRepository;
  hashRefreshToken: (token: string) => Promise<string>;
  storagePaths: StoragePaths;
}

export function uploadsModule(options: UploadsModuleOptions) {
  const uploads = new UploadsService({
    repository: options.repository,
    hashRefreshToken: options.hashRefreshToken,
    storagePaths: options.storagePaths,
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
    storagePaths: options.storagePaths,
    now: () => new Date(),
  });

  const releaseProcessing = new ReleaseProcessingService({
    repository: options.repository,
    storagePaths: options.storagePaths,
    now: () => new Date(),
  });

  return new Elysia({ name: "upload-details", prefix: "/_api/uploads/:uploadTaskId" })
    .model(uploadModels)
    .onError(({ code, status }) => {
      if (code === "VALIDATION") {
        return status(400, { code: "VALIDATION_ERROR" as const });
      }
    })
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
    )
    .put(
      "/raw",
      async ({ body, headers, params, status }) => {
        const result = await uploads.uploadRaw(headers, params, body);

        if (result instanceof UploadServiceError) {
          return status(toRawStatusCode(result.code), { code: result.code });
        }

        return result;
      },
      {
        headers: "Uploads.Headers",
        params: "Uploads.DetailParams",
        body: "Uploads.RawBody",
        response: {
          200: "Uploads.Detail",
          400: "Uploads.Error",
          401: "Uploads.Error",
          403: "Uploads.Error",
          404: "Uploads.Error",
          409: "Uploads.Error",
        },
      },
    )
    .post(
      "/complete",
      async ({ headers, params, status }) => {
        // Step 1: Mark as processing
        const result = await uploads.complete(headers, params);

        if (result instanceof UploadServiceError) {
          return status(toCompleteStatusCode(result.code), { code: result.code });
        }

        // Step 2: Process the release (extract, detect, manifest)
        const processingResult = await releaseProcessing.processUploadTask(result.uploadTask.id);

        // RAW_UPLOAD_REQUIRED is the only case that's an HTTP error
        if (processingResult instanceof ReleaseProcessingError && processingResult.code === "RAW_UPLOAD_REQUIRED") {
          return status(409, { code: "RAW_UPLOAD_REQUIRED" as const });
        }

        // All other processing results (success, DETECT_FAILED, DEPLOY_CORE_FAILED)
        // are returned as 200 with the refreshed upload task
        const refreshed = await uploads.get(headers, params);

        if (refreshed instanceof UploadServiceError) {
          return status(toCompleteStatusCode(refreshed.code), { code: refreshed.code });
        }

        return refreshed;
      },
      {
        headers: "Uploads.Headers",
        params: "Uploads.DetailParams",
        response: {
          200: "Uploads.Detail",
          401: "Uploads.Error",
          403: "Uploads.Error",
          404: "Uploads.Error",
          409: "Uploads.Error",
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

function toCompleteStatusCode(code: string): 401 | 403 | 404 | 409 {
  if (code === "UNAUTHORIZED") return 401;
  if (code === "FORBIDDEN") return 403;
  if (code === "UPLOAD_TASK_NOT_PENDING") return 409;
  if (code === "UPLOAD_TASK_NOT_UPLOADING") return 409;
  if (code === "RAW_UPLOAD_REQUIRED") return 409;
  return 404;
}

function toRawStatusCode(code: string): 400 | 401 | 403 | 404 | 409 {
  if (code === "UNAUTHORIZED") return 401;
  if (code === "FORBIDDEN") return 403;
  if (code === "UPLOAD_TASK_NOT_PENDING") return 409;
  if (code === "UPLOAD_TASK_NOT_UPLOADING") return 409;
  if (code === "RAW_UPLOAD_REQUIRED") return 400;
  return 404;
}
