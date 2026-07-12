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

export const InvitationRevokeParamsModel = t.Object({
  organizationId: t.String(),
  invitationId: t.String(),
});
export type InvitationRevokeParams = Static<typeof InvitationRevokeParamsModel>;

export const InvitationTokenParamsModel = t.Object({
  token: t.String(),
});
export type InvitationTokenParams = Static<typeof InvitationTokenParamsModel>;

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

export const InvitationItemModel = t.Object({
  id: t.String(),
  email: t.String(),
  role: t.String(),
  status: t.String(),
  createdAt: t.String(),
  expiresAt: t.String(),
});
export const InvitationListModel = t.Object({
  invitations: t.Array(InvitationItemModel),
});
export type InvitationList = Static<typeof InvitationListModel>;

export const InvitationAcceptModel = t.Object({
  ok: t.Literal(true),
  organizationId: t.String(),
});

export const InvitationsOkModel = t.Object({
  ok: t.Literal(true),
});

export const InvitationsErrorModel = t.Object({
  code: t.Union([
    t.Literal("UNAUTHORIZED"),
    t.Literal("FORBIDDEN"),
    t.Literal("USER_NOT_FOUND"),
    t.Literal("ALREADY_MEMBER"),
    t.Literal("INVITATION_PENDING"),
    t.Literal("NOT_FOUND"),
    t.Literal("EXPIRED"),
    t.Literal("ALREADY_ACCEPTED"),
    t.Literal("WRONG_USER"),
    t.Literal("VALIDATION_ERROR"),
  ]),
});

/* ─── Models ─── */
export const invitationsModels = {
  "Invitations.Headers": InvitationsHeadersModel,
  "Invitations.Params": InvitationsParamsModel,
  "Invitations.RevokeParams": InvitationRevokeParamsModel,
  "Invitations.TokenParams": InvitationTokenParamsModel,
  "Invitations.Body": InviteBodyModel,
  "Invitations.Success": InviteSuccessModel,
  "Invitations.List": InvitationListModel,
  "Invitations.Accepted": InvitationAcceptModel,
  "Invitations.Ok": InvitationsOkModel,
  "Invitations.Error": InvitationsErrorModel,
};

/* ─── Errors ─── */
export type InvitationErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "USER_NOT_FOUND"
  | "ALREADY_MEMBER"
  | "INVITATION_PENDING"
  | "NOT_FOUND"
  | "EXPIRED"
  | "ALREADY_ACCEPTED"
  | "WRONG_USER";

export class InvitationsServiceError {
  constructor(public readonly code: InvitationErrorCode) {}
}
export class InvitationsUnauthorizedError extends InvitationsServiceError {
  constructor() {
    super("UNAUTHORIZED");
  }
}
export class InvitationsForbiddenError extends InvitationsServiceError {
  constructor() {
    super("FORBIDDEN");
  }
}
export class InvitationsUserNotFoundError extends InvitationsServiceError {
  constructor() {
    super("USER_NOT_FOUND");
  }
}
export class InvitationsAlreadyMemberError extends InvitationsServiceError {
  constructor() {
    super("ALREADY_MEMBER");
  }
}
export class InvitationsPendingError extends InvitationsServiceError {
  constructor() {
    super("INVITATION_PENDING");
  }
}
export class InvitationsNotFoundError extends InvitationsServiceError {
  constructor() {
    super("NOT_FOUND");
  }
}
export class InvitationsExpiredError extends InvitationsServiceError {
  constructor() {
    super("EXPIRED");
  }
}
export class InvitationsAlreadyAcceptedError extends InvitationsServiceError {
  constructor() {
    super("ALREADY_ACCEPTED");
  }
}
export class InvitationsWrongUserError extends InvitationsServiceError {
  constructor() {
    super("WRONG_USER");
  }
}
