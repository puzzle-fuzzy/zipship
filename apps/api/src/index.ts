import { cors } from "@elysiajs/cors";
import { Elysia } from "elysia";
import { sql } from "drizzle-orm";
import { stat } from "fs/promises";
import { config } from "@zipship/config";
import { logger } from "./lib/logger";
import { createSessionOrApiTokenLookup } from "./lib/auth";
import {
  createProjectSitePath,
  createStoragePaths,
  ensureReleaseArtifactReady,
  switchCurrentReleaseLink,
} from "@zipship/storage";
import { authModule, hashRefreshToken } from "./modules/auth";
import { EmailService } from "./modules/email/service";
import { membersModule } from "./modules/members";
import { invitationAcceptModule, invitationsModule } from "./modules/invitations";
import { deploymentsModule } from "./modules/deployments";
import { organizationsModule } from "./modules/organizations";
import { projectDetailsModule, projectsModule } from "./modules/projects";
import { releasesModule } from "./modules/releases";
import { uploadDetailsModule, uploadsModule } from "./modules/uploads";
import { sitePreviewModule } from "./modules/site-preview";
import type { MemberRole } from "./modules/permissions/model";
import { getDb } from "./db/client";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { createDrizzleAuthRepository } from "./modules/auth/drizzle-repository";
import { createDrizzleAuditRepository } from "./modules/audit/drizzle-repository";
import { createDrizzleOrganizationsRepository } from "./modules/organizations/drizzle-repository";
import { createDrizzleProjectsRepository } from "./modules/projects/drizzle-repository";
import { createDrizzleReleasesRepository } from "./modules/releases/drizzle-repository";
import { createDrizzleUploadsRepository } from "./modules/uploads/drizzle-repository";
import { createDrizzleSitePreviewRepository } from "./modules/site-preview/drizzle-repository";
import { createDrizzleDeploymentsRepository } from "./modules/deployments/drizzle-repository";
import { createDrizzleReleaseProcessingRepository } from "./modules/release-processing/drizzle-repository";
import { createDrizzleMembersRepository } from "./modules/members/drizzle-repository";
import { createDrizzleInvitationsRepository } from "./modules/invitations/drizzle-repository";
import { createDrizzleApiTokensRepository } from "./modules/api-tokens/drizzle-repository";
import { apiTokensModule } from "./modules/api-tokens";

export interface CreateAppOptions {
  storageRoot?: string;
  exposeTestRoutes?: boolean;
  db?: NodePgDatabase<any>;
}

/**
 * Dependency container — all repositories, services, and storage handles bound
 * to a single DB connection. Extracted from the HTTP app so tests (and future
 * background jobs) can use the wired services without spinning up Elysia.
 */
export interface Container {
  db: NodePgDatabase<any>;
  storageRoot: string;
  storagePaths: ReturnType<typeof createStoragePaths>;
  deploymentStorage: {
    createProjectSitePath: (projectSlug: string) => string;
    ensureReleaseArtifactReady: typeof ensureReleaseArtifactReady;
    switchCurrentReleaseLink: typeof switchCurrentReleaseLink;
  };
  authRepository: ReturnType<typeof createDrizzleAuthRepository>;
  auditRepository: ReturnType<typeof createDrizzleAuditRepository>;
  organizationsRepository: ReturnType<typeof createDrizzleOrganizationsRepository>;
  projectsRepository: ReturnType<typeof createDrizzleProjectsRepository>;
  releasesRepository: ReturnType<typeof createDrizzleReleasesRepository>;
  uploadsRepository: ReturnType<typeof createDrizzleUploadsRepository>;
  sitePreviewRepository: ReturnType<typeof createDrizzleSitePreviewRepository>;
  deploymentsRepository: ReturnType<typeof createDrizzleDeploymentsRepository>;
  releaseProcessingRepository: ReturnType<typeof createDrizzleReleaseProcessingRepository>;
  membersRepositoryForModule: ReturnType<typeof createDrizzleMembersRepository>;
  invitationsRepository: ReturnType<typeof createDrizzleInvitationsRepository>;
  apiTokensRepository: ReturnType<typeof createDrizzleApiTokensRepository>;
  emailService: EmailService;
}

export function createContainer(options: CreateAppOptions = {}): Container {
  const db = options.db ?? getDb();
  const storageRoot = options.storageRoot ?? config.storageRoot;
  const storagePaths = createStoragePaths(storageRoot);

  const deploymentStorage = {
    createProjectSitePath: (projectSlug: string) =>
      createProjectSitePath(storagePaths, projectSlug),
    ensureReleaseArtifactReady,
    switchCurrentReleaseLink,
  };

  const authRepository = createDrizzleAuthRepository(db);
  const auditRepository = createDrizzleAuditRepository(db);
  const organizationsRepository = createDrizzleOrganizationsRepository(db);
  const projectsRepository = createDrizzleProjectsRepository(db);
  const releasesRepository = createDrizzleReleasesRepository(db);
  const uploadsRepository = createDrizzleUploadsRepository(db);
  const sitePreviewRepository = createDrizzleSitePreviewRepository(db);
  const deploymentsRepository = createDrizzleDeploymentsRepository(db);
  const releaseProcessingRepository = createDrizzleReleaseProcessingRepository(db);
  const membersRepositoryForModule = createDrizzleMembersRepository(db);
  const invitationsRepository = createDrizzleInvitationsRepository(db);
  const apiTokensRepository = createDrizzleApiTokensRepository(db);
  const emailService = new EmailService({ appBaseUrl: config.appUrl });

  return {
    db,
    storageRoot,
    storagePaths,
    deploymentStorage,
    authRepository,
    auditRepository,
    organizationsRepository,
    projectsRepository,
    releasesRepository,
    uploadsRepository,
    sitePreviewRepository,
    deploymentsRepository,
    releaseProcessingRepository,
    membersRepositoryForModule,
    invitationsRepository,
    apiTokensRepository,
    emailService,
  };
}

/**
 * Compose the full Elysia control-plane app from a wired container.
 * Return type is intentionally inferred so `type App = typeof app` carries the
 * full route contract for the Eden Treaty client.
 */
export function composeHttpApp(
  container: Container,
  options: { exposeTestRoutes?: boolean } = {},
) {
  const {
    db,
    storageRoot,
    deploymentStorage,
    authRepository,
    auditRepository,
    organizationsRepository,
    projectsRepository,
    releasesRepository,
    uploadsRepository,
    sitePreviewRepository,
    deploymentsRepository,
    releaseProcessingRepository,
    membersRepositoryForModule,
    invitationsRepository,
    apiTokensRepository,
    emailService,
  } = container;

  // `authRepository` backs sessions; `organizationsRepository` backs membership.
  // Resource modules get a composite that also accepts API tokens (CLI/CI),
  // while auth-only endpoints (me/logout/password-reset) keep the raw repository.
  const sessionRepository = createSessionOrApiTokenLookup(authRepository, apiTokensRepository);
  const membersRepository = organizationsRepository;

  const api = new Elysia()
    .use(cors({
      origin: /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization"],
      maxAge: 86400,
    }))
    .get("/_health", async ({ set }) => {
      const checks: Record<string, "ok" | "fail"> = {};
      try {
        await db.execute(sql`SELECT 1`);
        checks.db = "ok";
      } catch {
        checks.db = "fail";
      }
      try {
        await stat(storageRoot);
        checks.storage = "ok";
      } catch {
        checks.storage = "fail";
      }
      const ok = Object.values(checks).every((v) => v === "ok");
      set.status = ok ? 200 : 503;
      return { status: ok ? "ok" : "degraded", service: "zipship-api", checks };
    });

  if (options.exposeTestRoutes) {
    api.get("/_api/__test/auditLogs", async () => ({
      auditLogs: await auditRepository.listAuditLogsForTest(),
    }));
    api.put("/_api/__test/memberRole", async ({ body }) => {
      await organizationsRepository.setMemberRoleForTest(
        body as { organizationId: string; userId: string; role: MemberRole },
      );
      return { ok: true };
    });
    api.put("/_api/__test/releaseState", async ({ body }) => {
      await releasesRepository.setReleaseStateForTest(
        body as { releaseId: string; status: "uploading" | "processing" | "ready" | "active" | "failed" | "archived" | "deleted"; archived: boolean },
      );
      return { ok: true };
    });
  }

  return api
    .use(authModule({
      authRepository,
      auditRepository,
      emailService,
      hashToken: (token: string) => hashRefreshToken(token),
      randomToken: () => crypto.randomUUID(),
      appBaseUrl: config.appUrl,
    }))
    .use(organizationsModule({ organizationsRepository, sessionRepository, hashRefreshToken, auditRepository }))
    .use(projectsModule({ sessionRepository, membersRepository, projectsRepository, hashRefreshToken }))
    .use(projectDetailsModule({ sessionRepository, membersRepository, projectsRepository, hashRefreshToken }))
    .use(releasesModule({ sessionRepository, projectsRepository, membersRepository, releasesRepository, hashRefreshToken }))
    .use(deploymentsModule({
      sessionRepository, projectsRepository, membersRepository, releasesRepository,
      deploymentsRepository, auditRepository, hashRefreshToken, storage: deploymentStorage,
    }))
    .use(uploadsModule({
      sessionRepository, projectsRepository, membersRepository, uploadsRepository,
      hashRefreshToken, storagePaths: container.storagePaths,
    }))
    .use(uploadDetailsModule({
      sessionRepository, projectsRepository, membersRepository, uploadsRepository,
      releaseProcessingRepository, hashRefreshToken, storagePaths: container.storagePaths,
    }))
    .use(sitePreviewModule({ repository: sitePreviewRepository }))
    .use(membersModule({
      sessionRepository,
      membersRepository: membersRepositoryForModule,
      organizationsRepository,
      hashRefreshToken,
    }))
    .use(invitationsModule({
      sessionRepository,
      authRepository,
      organizationsRepository,
      invitationsRepository,
      emailService,
      invitationBaseUrl: config.appUrl,
      hashRefreshToken,
      hashToken: (token: string) => hashRefreshToken(token),
      randomToken: () => crypto.randomUUID(),
    }))
    .use(invitationAcceptModule({
      sessionRepository,
      authRepository,
      organizationsRepository,
      invitationsRepository,
      emailService,
      invitationBaseUrl: config.appUrl,
      hashRefreshToken,
      hashToken: (token: string) => hashRefreshToken(token),
      randomToken: () => crypto.randomUUID(),
    }))
    .use(apiTokensModule({
      sessionRepository,
      apiTokensRepository,
      hashRefreshToken,
      hashToken: (token: string) => hashRefreshToken(token),
      randomToken: () => crypto.randomUUID(),
    }));
}

/** Build the default app: wire a container, then compose HTTP over it. */
export function createApp(options: CreateAppOptions = {}) {
  return composeHttpApp(createContainer(options), {
    exposeTestRoutes: options.exposeTestRoutes,
  });
}

export const app = createApp();

export type App = typeof app;

if (import.meta.main) {
  app.listen(config.apiPort);
  logger.info("zipship api listening", { port: config.apiPort });
}
