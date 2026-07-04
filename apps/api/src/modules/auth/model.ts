import { t } from "elysia";

export const registerBodyModel = t.Object({
  name: t.String({ minLength: 1 }),
  email: t.String({ minLength: 1 }),
  password: t.String({ minLength: 8 }),
});

export const registerSuccessModel = t.Object({
  user: t.Object({
    id: t.String(),
    name: t.String(),
    email: t.String(),
  }),
  organization: t.Object({
    id: t.String(),
    name: t.String(),
    slug: t.String(),
  }),
  member: t.Object({
    id: t.String(),
    role: t.Literal("owner"),
  }),
});

export const loginBodyModel = t.Object({
  email: t.String({ minLength: 1 }),
  password: t.String({ minLength: 8 }),
  clientType: t.Optional(t.Union([t.Literal("web"), t.Literal("desktop")])),
});

export const loginSuccessModel = t.Object({
  user: t.Object({
    id: t.String(),
    name: t.String(),
    email: t.String(),
  }),
  session: t.Object({
    id: t.String(),
    clientType: t.Union([t.Literal("web"), t.Literal("desktop")]),
    refreshToken: t.String(),
    expiresAt: t.String(),
  }),
});

export const meHeadersModel = t.Object({
  authorization: t.Optional(t.String()),
});

export const meSuccessModel = t.Object({
  user: t.Object({
    id: t.String(),
    name: t.String(),
    email: t.String(),
  }),
  session: t.Object({
    id: t.String(),
    clientType: t.Union([t.Literal("web"), t.Literal("desktop")]),
    expiresAt: t.String(),
  }),
});

export const authErrorModel = t.Object({
  code: t.Union([
    t.Literal("DUPLICATE_EMAIL"),
    t.Literal("INVALID_CREDENTIALS"),
    t.Literal("INVALID_REGISTRATION_INPUT"),
    t.Literal("UNAUTHORIZED"),
    t.Literal("VALIDATION_ERROR"),
  ]),
});

export const authModels = {
  "Auth.RegisterBody": registerBodyModel,
  "Auth.RegisterSuccess": registerSuccessModel,
  "Auth.LoginBody": loginBodyModel,
  "Auth.LoginSuccess": loginSuccessModel,
  "Auth.MeHeaders": meHeadersModel,
  "Auth.MeSuccess": meSuccessModel,
  "Auth.Error": authErrorModel,
};

export type RegisterBody = typeof registerBodyModel.static;
export type RegisterSuccess = typeof registerSuccessModel.static;
export type LoginBody = typeof loginBodyModel.static;
export type LoginSuccess = typeof loginSuccessModel.static;
export type MeHeaders = typeof meHeadersModel.static;
export type MeSuccess = typeof meSuccessModel.static;
export type AuthErrorCode = typeof authErrorModel.static.code;

export class AuthServiceError {
  constructor(public readonly code: AuthErrorCode) {}
}

export class DuplicateEmailError extends AuthServiceError {
  constructor() {
    super("DUPLICATE_EMAIL");
  }
}

export class InvalidCredentialsError extends AuthServiceError {
  constructor() {
    super("INVALID_CREDENTIALS");
  }
}

export class UnauthorizedError extends AuthServiceError {
  constructor() {
    super("UNAUTHORIZED");
  }
}

export class InvalidRegistrationInputError extends AuthServiceError {
  constructor() {
    super("INVALID_REGISTRATION_INPUT");
  }
}
