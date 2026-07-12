import { t } from "elysia";
import type { Static } from "elysia";

/* ─── Headers ─── */
export const MembersHeadersModel = t.Object({
  authorization: t.Optional(t.String()),
});
export type MembersHeaders = Static<typeof MembersHeadersModel>;

/* ─── URL params ─── */
export const MembersParamsModel = t.Object({
  organizationId: t.String(),
});
export type MembersParams = Static<typeof MembersParamsModel>;

/** Params for member-mutate routes (organization + target user). */
export const MemberTargetParamsModel = t.Object({
  organizationId: t.String(),
  userId: t.String(),
});
export type MemberTargetParams = Static<typeof MemberTargetParamsModel>;

/** Body for role change (owner is excluded — ownership transfer is separate). */
export const ChangeRoleBodyModel = t.Object({
  role: t.Union([
    t.Literal("admin"),
    t.Literal("developer"),
    t.Literal("deployer"),
    t.Literal("viewer"),
  ]),
});
export type ChangeRoleBody = Static<typeof ChangeRoleBodyModel>;

/* ─── Response ─── */
export const MemberItemModel = t.Object({
  id: t.String(),
  userId: t.String(),
  name: t.String(),
  email: t.String(),
  role: t.String(),
  joinedAt: t.String(),
});
export const MemberListModel = t.Object({
  members: t.Array(MemberItemModel),
});
export type MemberList = Static<typeof MemberListModel>;

export const MembersOkModel = t.Object({ ok: t.Literal(true) });

export const MembersErrorModel = t.Object({
  code: t.Union([
    t.Literal("UNAUTHORIZED"),
    t.Literal("FORBIDDEN"),
    t.Literal("NOT_FOUND"),
    t.Literal("LAST_OWNER"),
    t.Literal("VALIDATION_ERROR"),
  ]),
});

/* ─── Models ─── */
export const membersModels = {
  "Members.Headers": MembersHeadersModel,
  "Members.Params": MembersParamsModel,
  "Members.TargetParams": MemberTargetParamsModel,
  "Members.ChangeRoleBody": ChangeRoleBodyModel,
  "Members.Success": MemberListModel,
  "Members.Ok": MembersOkModel,
  "Members.Error": MembersErrorModel,
};

/* ─── Errors ─── */
export type MemberErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "LAST_OWNER"
  | "VALIDATION_ERROR";

export class MembersServiceError {
  constructor(public readonly code: MemberErrorCode) {}
}
export class MembersUnauthorizedError extends MembersServiceError {
  constructor() {
    super("UNAUTHORIZED");
  }
}
export class MembersForbiddenError extends MembersServiceError {
  constructor() {
    super("FORBIDDEN");
  }
}
export class MembersNotFoundError extends MembersServiceError {
  constructor() {
    super("NOT_FOUND");
  }
}
export class MembersLastOwnerError extends MembersServiceError {
  constructor() {
    super("LAST_OWNER");
  }
}
