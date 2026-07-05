import { Elysia } from "elysia";
import { releaseModels, ReleaseServiceError } from "./model";
import { ReleasesService } from "./service";
import type { ReleasesRepository } from "./service";

export interface ReleasesModuleOptions {
  repository: ReleasesRepository;
  hashRefreshToken: (token: string) => Promise<string>;
}

export function releasesModule(options: ReleasesModuleOptions) {
  const releases = new ReleasesService({
    repository: options.repository,
    hashRefreshToken: options.hashRefreshToken,
    now: () => new Date(),
  });

  return new Elysia({ name: "releases", prefix: "/_api/projects/:projectId/releases" })
    .model(releaseModels)
    .onError(({ code, status }) => {
      if (code === "VALIDATION") {
        return status(400, { code: "VALIDATION_ERROR" as const });
      }
    })
    .get(
      "/",
      async ({ headers, params, status }) => {
        const result = await releases.list(headers, params);

        if (result instanceof ReleaseServiceError) {
          return status(toStatusCode(result.code), { code: result.code });
        }

        return result;
      },
      {
        headers: "Releases.Headers",
        params: "Releases.Params",
        response: {
          200: "Releases.List",
          400: "Releases.Error",
          401: "Releases.Error",
          403: "Releases.Error",
          404: "Releases.Error",
        },
      },
    );
}

function toStatusCode(code: string): 401 | 403 | 404 {
  if (code === "UNAUTHORIZED") return 401;
  if (code === "FORBIDDEN") return 403;
  return 404;
}
