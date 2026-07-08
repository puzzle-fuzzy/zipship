import { t } from "elysia";

export const apiTokenHeadersModel = t.Object({
  authorization: t.Optional(t.String()),
});

export const createApiTokenBodyModel = t.Object({
  name: t.String({ minLength: 1, maxLength: 120 }),
});

/** Metadata for a stored token (never includes the hash or plaintext). */
export const apiTokenItemModel = t.Object({
  id: t.String(),
  name: t.String(),
  createdAt: t.String(),
  lastUsedAt: t.Nullable(t.String()),
});

export const apiTokenListResponseModel = t.Object({
  tokens: t.Array(apiTokenItemModel),
});

/** Returned exactly once at creation — the plaintext token is shown then discarded. */
export const createApiTokenResponseModel = t.Object({
  id: t.String(),
  name: t.String(),
  token: t.String(),
  createdAt: t.String(),
});

export const apiTokenOkModel = t.Object({ ok: t.Literal(true) });

export const apiTokenErrorModel = t.Object({
  code: t.Union([
    t.Literal("UNAUTHORIZED"),
    t.Literal("NOT_FOUND"),
    t.Literal("VALIDATION_ERROR"),
  ]),
});

export const apiTokenModels = {
  "ApiToken.Headers": apiTokenHeadersModel,
  "ApiToken.CreateBody": createApiTokenBodyModel,
  "ApiToken.List": apiTokenListResponseModel,
  "ApiToken.Created": createApiTokenResponseModel,
  "ApiToken.Ok": apiTokenOkModel,
  "ApiToken.Error": apiTokenErrorModel,
};

export type ApiTokenHeaders = typeof apiTokenHeadersModel.static;
