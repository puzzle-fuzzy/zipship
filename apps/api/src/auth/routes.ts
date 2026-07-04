import { Elysia, t } from "elysia";
import { createAuthService, DuplicateEmailError, InvalidRegistrationInputError } from "./auth-service";
import type { AuthRepository } from "./auth-service";

export interface AuthRoutesOptions {
  repository: AuthRepository;
}

export function createAuthRoutes(options: AuthRoutesOptions) {
  const auth = createAuthService({
    repository: options.repository,
    hashPassword: (password) => Bun.password.hash(password),
  });

  return new Elysia({ prefix: "/_api/auth" }).post(
    "/register",
    async ({ body, set }) => {
      try {
        const result = await auth.register(body);
        set.status = 201;
        return result;
      } catch (error) {
        if (error instanceof DuplicateEmailError) {
          set.status = 409;
          return {
            code: "DUPLICATE_EMAIL",
            message: "Email already registered",
          };
        }

        if (error instanceof InvalidRegistrationInputError) {
          set.status = 400;
          return {
            code: "INVALID_REGISTRATION_INPUT",
            message: error.message,
          };
        }

        throw error;
      }
    },
    {
      body: t.Object({
        name: t.String({ minLength: 1 }),
        email: t.String({ minLength: 1 }),
        password: t.String({ minLength: 8 }),
      }),
    },
  );
}
