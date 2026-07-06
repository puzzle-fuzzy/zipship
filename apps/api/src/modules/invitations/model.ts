import { t } from "elysia";
import type { Static } from "elysia";

/* ─── Headers ─── */
export const InvitationsHeadersModel = t.Object({
  authorization: t.Optional(t.String()),
});
export type InvitationsHeaders = Static<typeof InvitationsHeadersModel>;

/* ─── URL params ─── */
export const InvitationsParamsModel = t.Object({
  organizationId: t.String(),
});
export type InvitationsParams = Static<typeof InvitationsParamsModel>;

/* ─── Body ─── */
export const InviteBodyModel = t.Object({
  email: t.String({ format: "email" }),
  role: t.Union([t.Literal("admin"), t.Literal("developer"), t.Literal("deployer"), t.Literal("viewer")]),
});
export type InviteBody = Static<typeof InviteBodyModel>;

/* ─── Response ─── */
export const InviteSuccessModel = t.Object({
  id: t.String(),
  email: t.String(),
  role: t.String(),
  status: t.String(),
  inviteUrl: t.String(),
});
export type InviteSuccess = Static<typeof InviteSuccessModel>;

export const InvitationsErrorModel = t.Object({
  code: t.Union([
    t.Literal("UNAUTHORIZED"),
    t.Literal("FORBIDDEN"),
    t.Literal("USER_NOT_FOUND"),
    t.Literal("ALREADY_MEMBER"),
    t.Literal("INVITATION_PENDING"),
  ]),
});

/* ─── Models ─── */
export const invitationsModels = {
  "Invitations.Headers": InvitationsHeadersModel,
  "Invitations.Params": InvitationsParamsModel,
  "Invitations.Body": InviteBodyModel,
  "Invitations.Success": InviteSuccessModel,
  "Invitations.Error": InvitationsErrorModel,
};

/* ─── Errors ─── */
export type InvitationErrorCode = "UNAUTHORIZED" | "FORBIDDEN" | "USER_NOT_FOUND" | "ALREADY_MEMBER" | "INVITATION_PENDING";

export class InvitationsServiceError {
  constructor(public readonly code: InvitationErrorCode) {}
}
export class InvitationsUnauthorizedError extends InvitationsServiceError {
  constructor() { super("UNAUTHORIZED"); }
}
export class InvitationsForbiddenError extends InvitationsServiceError {
  constructor() { super("FORBIDDEN"); }
}
export class InvitationsUserNotFoundError extends InvitationsServiceError {
  constructor() { super("USER_NOT_FOUND"); }
}
export class InvitationsAlreadyMemberError extends InvitationsServiceError {
  constructor() { super("ALREADY_MEMBER"); }
}
export class InvitationsPendingError extends InvitationsServiceError {
  constructor() { super("INVITATION_PENDING"); }
}
