import { Elysia } from "elysia";
import { config } from "@zipship/config";
import { createStoragePaths } from "@zipship/storage";
import { authModule, hashRefreshToken } from "./modules/auth";
import { createInMemoryAuthRepository } from "./modules/auth/repository";
import { deploymentsModule } from "./modules/deployments";
import { organizationsModule } from "./modules/organizations";
import { projectDetailsModule, projectsModule } from "./modules/projects";
import { releasesModule } from "./modules/releases";
import { uploadDetailsModule, uploadsModule } from "./modules/uploads";
import { sitePreviewModule } from "./modules/site-preview";

export interface CreateAppOptions {
  storageRoot?: string;
  exposeTestRoutes?: boolean;
}

export function createApp(options: CreateAppOptions = {}) {
  const repository = createInMemoryAuthRepository();
  const storagePaths = createStoragePaths(options.storageRoot ?? config.storageRoot);

  const api = new Elysia().get("/_health", () => ({
    status: "ok",
    service: "zipship-api",
  }));

  if (options.exposeTestRoutes) {
    api.get("/_api/__test/auditLogs", async () => ({
      auditLogs: await repository.listAuditLogsForTest(),
    }));
  }

  return api
    .use(authModule({ repository }))
    .use(organizationsModule({ repository, hashRefreshToken }))
    .use(projectsModule({ repository, hashRefreshToken }))
    .use(projectDetailsModule({ repository, hashRefreshToken }))
    .use(releasesModule({ repository, hashRefreshToken }))
    .use(deploymentsModule({ repository, hashRefreshToken }))
    .use(uploadsModule({ repository, hashRefreshToken, storagePaths }))
    .use(uploadDetailsModule({ repository, hashRefreshToken, storagePaths }))
    .use(sitePreviewModule({ repository }));
}

export const app = createApp();

export type App = typeof app;

if (import.meta.main) {
  app.listen(config.apiPort);
  console.log(`ZipShip API listening on http://localhost:${config.apiPort}`);
}
