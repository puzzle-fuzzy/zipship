import { Elysia } from "elysia";
import { authModels, AuthServiceError } from "./model";
import { AuthService } from "./service";
import type { AuthRepository } from "./service";

export interface AuthModuleOptions {
  repository: AuthRepository;
}

export function authModule(options: AuthModuleOptions) {
  const auth = new AuthService({
    repository: options.repository,
    hashPassword: (password) => Bun.password.hash(password),
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
    );
}
