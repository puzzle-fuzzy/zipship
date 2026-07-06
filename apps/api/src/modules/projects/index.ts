import { Elysia } from "elysia";
import { projectModels, ProjectServiceError } from "./model";
import { ProjectsService } from "./service";
import type { ProjectsRepository } from "./service";
import type { AuthRepository } from "../auth/service";
import type { OrganizationsRepository } from "../organizations/service";

export interface ProjectsModuleOptions {
  sessionRepository: Pick<AuthRepository, "findSessionByRefreshTokenHash">;
  membersRepository: Pick<OrganizationsRepository, "findMembership">;
  projectsRepository: ProjectsRepository;
  hashRefreshToken: (token: string) => Promise<string>;
}

export function projectsModule(options: ProjectsModuleOptions) {
  const projects = new ProjectsService({
    sessionRepository: options.sessionRepository,
    membersRepository: options.membersRepository,
    projectsRepository: options.projectsRepository,
    hashRefreshToken: options.hashRefreshToken,
    now: () => new Date(),
  });

  return new Elysia({ name: "projects", prefix: "/_api/organizations/:organizationId/projects" })
    .model(projectModels)
    .onError(({ code, status }) => {
      if (code === "VALIDATION") {
        return status(400, { code: "VALIDATION_ERROR" as const });
      }
    })
    .post(
      "/",
      async ({ body, headers, params, status }) => {
        const result = await projects.create(headers, params, body);

        if (result instanceof ProjectServiceError) {
          return status(toStatusCode(result.code), { code: result.code });
        }

        return status(201, result);
      },
      {
        headers: "Projects.Headers",
        params: "Projects.Params",
        body: "Projects.CreateBody",
        response: {
          201: "Projects.CreateSuccess",
          400: "Projects.Error",
          401: "Projects.Error",
          403: "Projects.Error",
          409: "Projects.Error",
        },
      },
    )
    .get(
      "/",
      async ({ headers, params, status }) => {
        const result = await projects.list(headers, params);

        if (result instanceof ProjectServiceError) {
          return status(toListStatusCode(result.code), { code: result.code });
        }

        return result;
      },
      {
        headers: "Projects.Headers",
        params: "Projects.Params",
        response: {
          200: "Projects.List",
          401: "Projects.Error",
          403: "Projects.Error",
        },
      },
    );
}

export function projectDetailsModule(options: ProjectsModuleOptions) {
  const projects = new ProjectsService({
    sessionRepository: options.sessionRepository,
    membersRepository: options.membersRepository,
    projectsRepository: options.projectsRepository,
    hashRefreshToken: options.hashRefreshToken,
    now: () => new Date(),
  });

  return new Elysia({ name: "project-details", prefix: "/_api/projects/:projectId" })
    .model(projectModels)
    .get(
      "/",
      async ({ headers, params, status }) => {
        const result = await projects.get(headers, params);

        if (result instanceof ProjectServiceError) {
          return status(toDetailStatusCode(result.code), { code: result.code });
        }

        return result;
      },
      {
        headers: "Projects.Headers",
        params: "Projects.DetailParams",
        response: {
          200: "Projects.Detail",
          401: "Projects.Error",
          403: "Projects.Error",
          404: "Projects.Error",
        },
      },
    );
}

function toStatusCode(code: string): 400 | 401 | 403 | 409 {
  if (code === "UNAUTHORIZED") return 401;
  if (code === "FORBIDDEN") return 403;
  if (code === "DUPLICATE_PROJECT_SLUG") return 409;
  return 400;
}

function toListStatusCode(code: string): 401 | 403 {
  if (code === "UNAUTHORIZED") return 401;
  return 403;
}

function toDetailStatusCode(code: string): 401 | 403 | 404 {
  if (code === "UNAUTHORIZED") return 401;
  if (code === "PROJECT_NOT_FOUND") return 404;
  return 403;
}
