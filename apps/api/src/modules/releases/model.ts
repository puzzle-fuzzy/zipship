import { t } from "elysia";

export const releaseHeadersModel = t.Object({
  authorization: t.Optional(t.String()),
});

export const releaseParamsModel = t.Object({
  projectId: t.String(),
});

export const releaseModel = t.Object({
  id: t.String(),
  projectId: t.String(),
  versionNumber: t.Number(),
  releaseHash: t.String(),
  fullHash: t.String(),
  status: t.Union([
    t.Literal("uploading"),
    t.Literal("processing"),
    t.Literal("ready"),
    t.Literal("active"),
    t.Literal("failed"),
    t.Literal("archived"),
    t.Literal("deleted"),
  ]),
  storagePath: t.String(),
  rawUploadPath: t.Nullable(t.String()),
  fileCount: t.Number(),
  totalSize: t.Number(),
  manifest: t.Record(t.String(), t.Unknown()),
  detectResult: t.Record(t.String(), t.Unknown()),
  createdBy: t.String(),
  createdAt: t.String(),
  activatedAt: t.Nullable(t.String()),
  archivedAt: t.Nullable(t.String()),
});

export const releaseListModel = t.Object({
  releases: t.Array(releaseModel),
});

export const releaseErrorModel = t.Object({
  code: t.Union([
    t.Literal("UNAUTHORIZED"),
    t.Literal("FORBIDDEN"),
    t.Literal("PROJECT_NOT_FOUND"),
    t.Literal("VALIDATION_ERROR"),
  ]),
});

export const releaseModels = {
  "Releases.Headers": releaseHeadersModel,
  "Releases.Params": releaseParamsModel,
  "Releases.List": releaseListModel,
  "Releases.Error": releaseErrorModel,
};

export type ReleaseHeaders = typeof releaseHeadersModel.static;
export type ReleaseParams = typeof releaseParamsModel.static;
export type Release = typeof releaseModel.static;
export type ReleaseList = typeof releaseListModel.static;
export type ReleaseErrorCode = typeof releaseErrorModel.static.code;

export class ReleaseServiceError {
  constructor(public readonly code: ReleaseErrorCode) {}
}

export class ReleaseUnauthorizedError extends ReleaseServiceError {
  constructor() {
    super("UNAUTHORIZED");
  }
}

export class ReleaseForbiddenError extends ReleaseServiceError {
  constructor() {
    super("FORBIDDEN");
  }
}

export class ReleaseProjectNotFoundError extends ReleaseServiceError {
  constructor() {
    super("PROJECT_NOT_FOUND");
  }
}
