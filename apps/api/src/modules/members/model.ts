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

export const MembersErrorModel = t.Object({
  code: t.Union([t.Literal("UNAUTHORIZED"), t.Literal("FORBIDDEN")]),
});

/* ─── Models ─── */
export const membersModels = {
  "Members.Headers": MembersHeadersModel,
  "Members.Params": MembersParamsModel,
  "Members.Success": MemberListModel,
  "Members.Error": MembersErrorModel,
};

/* ─── Errors ─── */
export class MembersServiceError {
  constructor(public readonly code: "UNAUTHORIZED" | "FORBIDDEN") {}
}
export class MembersUnauthorizedError extends MembersServiceError {
  constructor() { super("UNAUTHORIZED"); }
}
export class MembersForbiddenError extends MembersServiceError {
  constructor() { super("FORBIDDEN"); }
}
