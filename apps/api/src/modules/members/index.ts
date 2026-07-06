import { Elysia } from "elysia";
import { MembersService, type MembersRepository } from "./service";
import { membersModels, MembersUnauthorizedError, MembersForbiddenError } from "./model";
import type { AuthRepository } from "../auth/service";
import type { MemberRole } from "../permissions/model";
import type { PermissionService } from "../permissions/service";

export interface MembersModuleOptions {
  sessionRepository: Pick<AuthRepository, "findSessionByRefreshTokenHash">;
  membersRepository: MembersRepository;
  organizationsRepository: {
    findMembership(input: { organizationId: string; userId: string }): Promise<{ role: MemberRole } | null>;
  };
  hashRefreshToken: (token: string) => Promise<string>;
  permissions?: PermissionService;
}

export function membersModule(options: MembersModuleOptions) {
  const service = new MembersService({
    sessionRepository: options.sessionRepository,
    membersRepository: options.membersRepository,
    organizationsRepository: options.organizationsRepository,
    hashRefreshToken: options.hashRefreshToken,
    now: () => new Date(),
    permissions: options.permissions,
  });

  return new Elysia({ name: "members-module", prefix: "/_api/organizations/:organizationId/members" })
    .model(membersModels)
    .onError(({ code, status }) => {
      if (code === "VALIDATION") return status(400, { code: "VALIDATION_ERROR" as const });
    })
    .get("/", async ({ headers, params, status: setStatus }) => {
      const result = await service.list(headers as any, params as any);
      if (result instanceof MembersUnauthorizedError) return setStatus(401, { code: "UNAUTHORIZED" as const });
      if (result instanceof MembersForbiddenError) return setStatus(403, { code: "FORBIDDEN" as const });
      return result;
    }, {
      headers: "Members.Headers",
      params: "Members.Params",
      response: {
        200: "Members.Success",
        401: "Members.Error",
        403: "Members.Error",
      },
    });
}

export { MembersService } from "./service";
export type { MembersRepository } from "./service";
