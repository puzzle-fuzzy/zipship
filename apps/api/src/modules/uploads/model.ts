import { t } from "elysia";

export const uploadHeadersModel = t.Object({
  authorization: t.Optional(t.String()),
});

export const uploadParamsModel = t.Object({
  projectId: t.String(),
});

export const uploadDetailParamsModel = t.Object({
  uploadTaskId: t.String(),
});

export const createUploadTaskBodyModel = t.Object({
  originalFilename: t.String({ minLength: 1 }),
  size: t.Number({ minimum: 1 }),
});

export const uploadTaskModel = t.Object({
  id: t.String(),
  projectId: t.String(),
  releaseId: t.Nullable(t.String()),
  status: t.Union([t.Literal("pending"), t.Literal("processing")]),
  rawUploadPath: t.String(),
  originalFilename: t.String(),
  size: t.Number(),
  errorMessage: t.Nullable(t.String()),
  createdBy: t.String(),
  createdAt: t.String(),
  startedAt: t.Nullable(t.String()),
  finishedAt: t.Nullable(t.String()),
});

export const createUploadTaskSuccessModel = t.Object({
  uploadTask: uploadTaskModel,
});

export const uploadTaskDetailModel = t.Object({
  uploadTask: uploadTaskModel,
});

export const uploadErrorModel = t.Object({
  code: t.Union([
    t.Literal("UNAUTHORIZED"),
    t.Literal("FORBIDDEN"),
    t.Literal("PROJECT_NOT_FOUND"),
    t.Literal("UPLOAD_TASK_NOT_FOUND"),
    t.Literal("UPLOAD_TASK_NOT_PENDING"),
    t.Literal("INVALID_UPLOAD_INPUT"),
    t.Literal("VALIDATION_ERROR"),
  ]),
});

export const uploadModels = {
  "Uploads.Headers": uploadHeadersModel,
  "Uploads.Params": uploadParamsModel,
  "Uploads.DetailParams": uploadDetailParamsModel,
  "Uploads.CreateBody": createUploadTaskBodyModel,
  "Uploads.CreateSuccess": createUploadTaskSuccessModel,
  "Uploads.Detail": uploadTaskDetailModel,
  "Uploads.Error": uploadErrorModel,
};

export type UploadHeaders = typeof uploadHeadersModel.static;
export type UploadParams = typeof uploadParamsModel.static;
export type UploadDetailParams = typeof uploadDetailParamsModel.static;
export type CreateUploadTaskBody = typeof createUploadTaskBodyModel.static;
export type UploadTask = typeof uploadTaskModel.static;
export type CreateUploadTaskSuccess = typeof createUploadTaskSuccessModel.static;
export type UploadTaskDetail = typeof uploadTaskDetailModel.static;
export type UploadErrorCode = typeof uploadErrorModel.static.code;

export class UploadServiceError {
  constructor(public readonly code: UploadErrorCode) {}
}

export class UploadUnauthorizedError extends UploadServiceError {
  constructor() {
    super("UNAUTHORIZED");
  }
}

export class UploadForbiddenError extends UploadServiceError {
  constructor() {
    super("FORBIDDEN");
  }
}

export class UploadProjectNotFoundError extends UploadServiceError {
  constructor() {
    super("PROJECT_NOT_FOUND");
  }
}

export class UploadTaskNotFoundError extends UploadServiceError {
  constructor() {
    super("UPLOAD_TASK_NOT_FOUND");
  }
}

export class UploadTaskNotPendingError extends UploadServiceError {
  constructor() {
    super("UPLOAD_TASK_NOT_PENDING");
  }
}

export class InvalidUploadInputError extends UploadServiceError {
  constructor() {
    super("INVALID_UPLOAD_INPUT");
  }
}
