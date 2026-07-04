import { Elysia } from "elysia";
import { authModule } from "./modules/auth";
import { createInMemoryAuthRepository } from "./modules/auth/repository";

export function createApp() {
  return new Elysia()
    .get("/_health", () => ({
      status: "ok",
      service: "zipship-api",
    }))
    .use(authModule({ repository: createInMemoryAuthRepository() }));
}

export const app = createApp();

export type App = typeof app;

if (import.meta.main) {
  const port = Number(process.env.ZIPSHIP_API_PORT ?? 3001);

  app.listen(port);
  console.log(`ZipShip API listening on http://localhost:${port}`);
}
