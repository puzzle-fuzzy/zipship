import { t } from "elysia";
import { projectModel } from "../projects/model";
import { releaseModel } from "../releases/model";

export const deploymentHeadersModel = t.Object({
  authorization: t.Optional(t.String()),
});

export const deploymentProjectParamsModel = t.Object({
  projectId: t.String(),
});

export const deploymentReleaseParamsModel = t.Object({
  projectId: t.String(),
  releaseId: t.String(),
});

export const deploymentBodyModel = t.Object({
  message: t.Nullable(t.Optional(t.String())),
});

export const deploymentModel = t.Object({
  id: t.String(),
  projectId: t.String(),
  releaseId: t.String(),
  previousReleaseId: t.Nullable(t.String()),
  action: t.Union([t.Literal("publish"), t.Literal("rollback")]),
  status: t.Literal("success"),
  operatorId: t.String(),
  message: t.Nullable(t.String()),
  createdAt: t.String(),
  finishedAt: t.Nullable(t.String()),
});

export const deploymentResultModel = t.Object({
  deployment: deploymentModel,
  project: projectModel,
  release: releaseModel,
  previousRelease: t.Nullable(releaseModel),
});

export const deploymentListModel = t.Object({
  deployments: t.Array(deploymentModel),
});

export const deploymentErrorModel = t.Object({
  code: t.Union([
    t.Literal("UNAUTHORIZED"),
    t.Literal("FORBIDDEN"),
    t.Literal("PROJECT_NOT_FOUND"),
    t.Literal("RELEASE_NOT_FOUND"),
    t.Literal("RELEASE_NOT_READY"),
    t.Literal("RELEASE_NOT_ROLLBACKABLE"),
    t.Literal("RELEASE_ALREADY_ACTIVE"),
    t.Literal("VALIDATION_ERROR"),
    t.Literal("RELEASE_ARTIFACT_NOT_FOUND"),
    t.Literal("FILESYSTEM_UPDATE_FAILED"),
  ]),
});

export const deploymentModels = {
  "Deployments.Headers": deploymentHeadersModel,
  "Deployments.ProjectParams": deploymentProjectParamsModel,
  "Deployments.ReleaseParams": deploymentReleaseParamsModel,
  "Deployments.Body": deploymentBodyModel,
  "Deployments.Result": deploymentResultModel,
  "Deployments.List": deploymentListModel,
  "Deployments.Error": deploymentErrorModel,
};

export type DeploymentHeaders = typeof deploymentHeadersModel.static;
export type DeploymentProjectParams = typeof deploymentProjectParamsModel.static;
export type DeploymentReleaseParams = typeof deploymentReleaseParamsModel.static;
export type DeploymentBody = typeof deploymentBodyModel.static;
export type Deployment = typeof deploymentModel.static;
export type DeploymentResult = typeof deploymentResultModel.static;
export type DeploymentList = typeof deploymentListModel.static;
export type DeploymentErrorCode = typeof deploymentErrorModel.static.code;

export class DeploymentServiceError {
  constructor(public readonly code: DeploymentErrorCode) {}
}

export class DeploymentUnauthorizedError extends DeploymentServiceError {
  constructor() {
    super("UNAUTHORIZED");
  }
}

export class DeploymentForbiddenError extends DeploymentServiceError {
  constructor() {
    super("FORBIDDEN");
  }
}

export class DeploymentProjectNotFoundError extends DeploymentServiceError {
  constructor() {
    super("PROJECT_NOT_FOUND");
  }
}

export class DeploymentReleaseNotFoundError extends DeploymentServiceError {
  constructor() {
    super("RELEASE_NOT_FOUND");
  }
}

export class DeploymentReleaseNotReadyError extends DeploymentServiceError {
  constructor() {
    super("RELEASE_NOT_READY");
  }
}

export class DeploymentReleaseNotRollbackableError extends DeploymentServiceError {
  constructor() {
    super("RELEASE_NOT_ROLLBACKABLE");
  }
}

export class DeploymentReleaseAlreadyActiveError extends DeploymentServiceError {
  constructor() {
    super("RELEASE_ALREADY_ACTIVE");
  }
}

export class DeploymentReleaseArtifactNotFoundError extends DeploymentServiceError {
  constructor() {
    super("RELEASE_ARTIFACT_NOT_FOUND");
  }
}

export class DeploymentFilesystemUpdateError extends DeploymentServiceError {
  constructor() {
    super("FILESYSTEM_UPDATE_FAILED");
  }
}
