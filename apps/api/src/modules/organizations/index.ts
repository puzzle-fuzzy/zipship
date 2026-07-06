import { Elysia } from "elysia";
import { organizationModels, OrganizationServiceError } from "./model";
import { OrganizationsService } from "./service";
import type { OrganizationsRepository } from "./service";
import type { AuthRepository } from "../auth/service";

export interface OrganizationsModuleOptions {
  organizationsRepository: OrganizationsRepository;
  sessionRepository: Pick<AuthRepository, "findSessionByRefreshTokenHash">;
  hashRefreshToken: (token: string) => Promise<string>;
}

export function organizationsModule(options: OrganizationsModuleOptions) {
  const organizations = new OrganizationsService({
    organizationsRepository: options.organizationsRepository,
    sessionRepository: options.sessionRepository,
    hashRefreshToken: options.hashRefreshToken,
    now: () => new Date(),
  });

  return new Elysia({ name: "organizations", prefix: "/_api/organizations" })
    .model(organizationModels)
    .get(
      "/",
      async ({ headers, status }) => {
        const result = await organizations.listForCurrentUser(headers);

        if (result instanceof OrganizationServiceError) {
          return status(401, { code: result.code });
        }

        return result;
      },
      {
        headers: "Organizations.Headers",
        response: {
          200: "Organizations.List",
          401: "Organizations.Error",
        },
      },
    );
}
