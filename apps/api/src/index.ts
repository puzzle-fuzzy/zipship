import { Elysia } from "elysia";
import { createInMemoryAuthRepository } from "./auth/in-memory-auth-repository";
import { createAuthRoutes } from "./auth/routes";

export function createApp() {
  return new Elysia()
    .get("/_health", () => ({
    status: "ok",
    service: "zipship-api",
  }))
    .use(createAuthRoutes({ repository: createInMemoryAuthRepository() }));
}

export const app = createApp();

export type App = typeof app;

if (import.meta.main) {
  const port = Number(process.env.ZIPSHIP_API_PORT ?? 3001);

  app.listen(port);
  console.log(`ZipShip API listening on http://localhost:${port}`);
}
