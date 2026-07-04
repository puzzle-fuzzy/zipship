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

export const authErrorModel = t.Object({
  code: t.Union([
    t.Literal("DUPLICATE_EMAIL"),
    t.Literal("INVALID_REGISTRATION_INPUT"),
    t.Literal("VALIDATION_ERROR"),
  ]),
});

export const authModels = {
  "Auth.RegisterBody": registerBodyModel,
  "Auth.RegisterSuccess": registerSuccessModel,
  "Auth.Error": authErrorModel,
};

export type RegisterBody = typeof registerBodyModel.static;
export type RegisterSuccess = typeof registerSuccessModel.static;
export type AuthErrorCode = typeof authErrorModel.static.code;

export class AuthServiceError {
  constructor(public readonly code: AuthErrorCode) {}
}

export class DuplicateEmailError extends AuthServiceError {
  constructor() {
    super("DUPLICATE_EMAIL");
  }
}

export class InvalidRegistrationInputError extends AuthServiceError {
  constructor() {
    super("INVALID_REGISTRATION_INPUT");
  }
}
