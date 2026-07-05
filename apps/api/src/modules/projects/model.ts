import { t } from "elysia";

export const projectHeadersModel = t.Object({
  authorization: t.Optional(t.String()),
});

export const projectParamsModel = t.Object({
  organizationId: t.String(),
});

export const projectDetailParamsModel = t.Object({
  projectId: t.String(),
});

export const createProjectBodyModel = t.Object({
  name: t.String({ minLength: 1 }),
  slug: t.String({ minLength: 1 }),
  description: t.Nullable(t.Optional(t.String())),
});

export const projectModel = t.Object({
  id: t.String(),
  organizationId: t.String(),
  name: t.String(),
  slug: t.String(),
  description: t.Nullable(t.String()),
  status: t.Literal("active"),
  visibility: t.Literal("private"),
  createdBy: t.String(),
  createdAt: t.String(),
  updatedAt: t.String(),
});

export const createProjectSuccessModel = t.Object({
  project: projectModel,
});

export const projectDetailModel = t.Object({
  project: projectModel,
});

export const projectListModel = t.Object({
  projects: t.Array(projectModel),
});

export const projectErrorModel = t.Object({
  code: t.Union([
    t.Literal("UNAUTHORIZED"),
    t.Literal("FORBIDDEN"),
    t.Literal("INVALID_PROJECT_INPUT"),
    t.Literal("DUPLICATE_PROJECT_SLUG"),
    t.Literal("PROJECT_NOT_FOUND"),
    t.Literal("VALIDATION_ERROR"),
  ]),
});

export const projectModels = {
  "Projects.Headers": projectHeadersModel,
  "Projects.Params": projectParamsModel,
  "Projects.DetailParams": projectDetailParamsModel,
  "Projects.CreateBody": createProjectBodyModel,
  "Projects.CreateSuccess": createProjectSuccessModel,
  "Projects.Detail": projectDetailModel,
  "Projects.List": projectListModel,
  "Projects.Error": projectErrorModel,
};

export type ProjectHeaders = typeof projectHeadersModel.static;
export type ProjectParams = typeof projectParamsModel.static;
export type ProjectDetailParams = typeof projectDetailParamsModel.static;
export type CreateProjectBody = typeof createProjectBodyModel.static;
export type Project = typeof projectModel.static;
export type CreateProjectSuccess = typeof createProjectSuccessModel.static;
export type ProjectDetail = typeof projectDetailModel.static;
export type ProjectList = typeof projectListModel.static;
export type ProjectErrorCode = typeof projectErrorModel.static.code;

export class ProjectServiceError {
  constructor(public readonly code: ProjectErrorCode) {}
}

export class ProjectUnauthorizedError extends ProjectServiceError {
  constructor() {
    super("UNAUTHORIZED");
  }
}

export class ProjectForbiddenError extends ProjectServiceError {
  constructor() {
    super("FORBIDDEN");
  }
}

export class InvalidProjectInputError extends ProjectServiceError {
  constructor() {
    super("INVALID_PROJECT_INPUT");
  }
}

export class DuplicateProjectSlugError extends ProjectServiceError {
  constructor() {
    super("DUPLICATE_PROJECT_SLUG");
  }
}

export class ProjectNotFoundError extends ProjectServiceError {
  constructor() {
    super("PROJECT_NOT_FOUND");
  }
}
