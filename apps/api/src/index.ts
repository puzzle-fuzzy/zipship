import { Elysia } from "elysia";
import { config } from "@zipship/config";
import { authModule, hashRefreshToken } from "./modules/auth";
import { createInMemoryAuthRepository } from "./modules/auth/repository";
import { organizationsModule } from "./modules/organizations";
import { projectDetailsModule, projectsModule } from "./modules/projects";
import { releasesModule } from "./modules/releases";
import { uploadDetailsModule, uploadsModule } from "./modules/uploads";

export function createApp() {
  const repository = createInMemoryAuthRepository();

  return new Elysia()
    .get("/_health", () => ({
      status: "ok",
      service: "zipship-api",
    }))
    .use(authModule({ repository }))
    .use(organizationsModule({ repository, hashRefreshToken }))
    .use(projectsModule({ repository, hashRefreshToken }))
    .use(projectDetailsModule({ repository, hashRefreshToken }))
    .use(releasesModule({ repository, hashRefreshToken }))
    .use(uploadsModule({ repository, hashRefreshToken }))
    .use(uploadDetailsModule({ repository, hashRefreshToken }));
}

export const app = createApp();

export type App = typeof app;

if (import.meta.main) {
  app.listen(config.apiPort);
  console.log(`ZipShip API listening on http://localhost:${config.apiPort}`);
}
