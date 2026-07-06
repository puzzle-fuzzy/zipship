import { Elysia } from "elysia";
import { InvitationsService, type InvitationsRepository } from "./service";
import {
  invitationsModels,
  InvitationsUnauthorizedError,
  InvitationsForbiddenError,
  InvitationsUserNotFoundError,
  InvitationsAlreadyMemberError,
  InvitationsPendingError,
} from "./model";
import type { AuthRepository } from "../auth/service";
import { EmailService } from "../email/service";
import type { MemberRole } from "../permissions/model";
import type { PermissionService } from "../permissions/service";

export interface InvitationsModuleOptions {
  sessionRepository: Pick<AuthRepository, "findSessionByRefreshTokenHash">;
  authRepository: Pick<AuthRepository, "findUserByEmail">;
  organizationsRepository: {
    findMembership(input: { organizationId: string; userId: string }): Promise<{ role: MemberRole } | null>;
    findOrganizationById(organizationId: string): Promise<{ name: string } | null>;
  };
  invitationsRepository: InvitationsRepository;
  emailService?: EmailService;
  invitationBaseUrl?: string;
  hashRefreshToken: (token: string) => Promise<string>;
  hashToken: (token: string) => Promise<string>;
  randomToken: () => string;
  permissions?: PermissionService;
}

export function invitationsModule(options: InvitationsModuleOptions) {
  const service = new InvitationsService({
    sessionRepository: options.sessionRepository,
    authRepository: options.authRepository,
    organizationsRepository: options.organizationsRepository,
    invitationsRepository: options.invitationsRepository,
    emailService: options.emailService,
    hashRefreshToken: options.hashRefreshToken,
    hashToken: options.hashToken,
    randomToken: options.randomToken,
    invitationBaseUrl: options.invitationBaseUrl,
    now: () => new Date(),
    permissions: options.permissions,
  });

  return new Elysia({ name: "invitations-module", prefix: "/_api/organizations/:organizationId/invitations" })
    .model(invitationsModels)
    .onError(({ code, status }) => {
      if (code === "VALIDATION") return status(400, { code: "VALIDATION_ERROR" as const });
    })
    .post("/", async ({ headers, params, body, status: setStatus }) => {
      const result = await service.invite(headers as any, params as any, body as any);
      if (result instanceof InvitationsUnauthorizedError) return setStatus(401, { code: "UNAUTHORIZED" as const });
      if (result instanceof InvitationsForbiddenError) return setStatus(403, { code: "FORBIDDEN" as const });
      if (result instanceof InvitationsUserNotFoundError) return setStatus(404, { code: "USER_NOT_FOUND" as const });
      if (result instanceof InvitationsAlreadyMemberError) return setStatus(409, { code: "ALREADY_MEMBER" as const });
      if (result instanceof InvitationsPendingError) return setStatus(409, { code: "INVITATION_PENDING" as const });
      return result;
    }, {
      headers: "Invitations.Headers",
      params: "Invitations.Params",
      body: "Invitations.Body",
      response: {
        200: "Invitations.Success",
        400: "Invitations.Error",
        401: "Invitations.Error",
        403: "Invitations.Error",
        404: "Invitations.Error",
        409: "Invitations.Error",
      },
    });
}

export { InvitationsService } from "./service";
export type { InvitationsRepository } from "./service";
