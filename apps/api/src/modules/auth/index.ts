import { Elysia } from "elysia";
import { authModels, AuthServiceError } from "./model";
import { AuthService } from "./service";
import type { AuthRepository } from "./service";
import type { AuditRepository } from "../audit/service";
import type { EmailService } from "../email/service";

export interface AuthModuleOptions {
  authRepository: AuthRepository;
  auditRepository: AuditRepository;
  emailService?: EmailService;
  hashToken: (token: string) => Promise<string>;
  randomToken: () => string;
  appBaseUrl: string;
}

export function authModule(options: AuthModuleOptions) {
  const auth = new AuthService({
    authRepository: options.authRepository,
    auditRepository: options.auditRepository,
    hashPassword: (password) => Bun.password.hash(password),
    verifyPassword: (password, hash) => Bun.password.verify(password, hash),
    createRefreshToken: () => crypto.randomUUID(),
    hashRefreshToken,
    now: () => new Date(),
    emailService: options.emailService,
    hashToken: options.hashToken,
    randomToken: options.randomToken,
    appBaseUrl: options.appBaseUrl,
  });

  return new Elysia({ name: "auth", prefix: "/_api/auth" })
    .model(authModels)
    .onError(({ code, status }) => {
      if (code === "VALIDATION") {
        return status(400, { code: "VALIDATION_ERROR" as const });
      }
    })
    .post(
      "/register",
      async ({ body, status }) => {
        const result = await auth.register(body);

        if (result instanceof AuthServiceError) {
          const statusCode = result.code === "DUPLICATE_EMAIL" ? 409 : 400;
          return status(statusCode, { code: result.code });
        }

        return status(201, result);
      },
      {
        body: "Auth.RegisterBody",
        response: {
          201: "Auth.RegisterSuccess",
          400: "Auth.Error",
          409: "Auth.Error",
        },
      },
    )
    .post(
      "/login",
      async ({ body, status }) => {
        const result = await auth.login(body);

        if (result instanceof AuthServiceError) {
          const statusCode = result.code === "INVALID_CREDENTIALS" ? 401 : 400;
          return status(statusCode, { code: result.code });
        }

        return result;
      },
      {
        body: "Auth.LoginBody",
        response: {
          200: "Auth.LoginSuccess",
          400: "Auth.Error",
          401: "Auth.Error",
        },
      },
    )
    .post(
      "/logout",
      async ({ headers, status }) => {
        const result = await auth.logout(headers);

        if (result instanceof AuthServiceError) {
          return status(401, { code: result.code });
        }

        return result;
      },
      {
        headers: "Auth.LogoutHeaders",
        response: {
          200: "Auth.LogoutSuccess",
          401: "Auth.Error",
        },
      },
    )
    .patch(
      "/me",
      async ({ headers, body, status }) => {
        const result = await auth.updateProfile(headers, body);

        if (result instanceof AuthServiceError) {
          return status(400, { code: result.code });
        }

        return result;
      },
      {
        headers: "Auth.MeHeaders",
        body: "Auth.UpdateProfileBody",
        response: {
          200: "Auth.MeSuccess",
          400: "Auth.Error",
          401: "Auth.Error",
        },
      },
    )
    .get(
      "/me",
      async ({ headers, status }) => {
        const result = await auth.me(headers);

        if (result instanceof AuthServiceError) {
          return status(401, { code: result.code });
        }

        return result;
      },
      {
        headers: "Auth.MeHeaders",
        response: {
          200: "Auth.MeSuccess",
          401: "Auth.Error",
        },
      },
    )
    .post(
      "/password-reset/request",
      async ({ body }) => {
        // Always ok — never reveals whether the email exists.
        return auth.requestPasswordReset(body);
      },
      {
        body: "Auth.PasswordResetRequest",
        response: {
          200: "Auth.Ok",
        },
      },
    )
    .post(
      "/password-reset/confirm",
      async ({ body, status }) => {
        const result = await auth.confirmPasswordReset(body);
        if (result instanceof AuthServiceError) {
          const statusCode = result.code === "EXPIRED_TOKEN" ? 410 : 400;
          return status(statusCode, { code: result.code });
        }
        return result;
      },
      {
        body: "Auth.PasswordResetConfirm",
        response: {
          200: "Auth.Ok",
          400: "Auth.Error",
          410: "Auth.Error",
        },
      },
    );
}

export async function hashRefreshToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
