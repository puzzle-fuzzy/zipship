# 发布与回滚控制面实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the release publish and rollback control plane so ready releases can become the project current release, historical ready releases can be restored, and every change is recorded in deployments and audit logs.

**Architecture:** Add a focused Elysia feature module at `apps/api/src/modules/deployments` with `model.ts`, `service.ts`, and `index.ts`. Keep permission checks and error mapping in the service/controller layer; keep atomic project/release/deployment mutations in the repository; reuse `AuditService.record()` for audit logs.

**Tech Stack:** Bun, Elysia 1.4.29, TypeBox via `elysia.t`, `@elysia/eden` Treaty tests, in-memory repository, existing `PermissionService`, existing `AuditService`.

## Global Constraints

- **测试先行是硬要求：每个任务必须先写会失败的测试，先运行并确认失败，再改实现。**
- Use existing Elysia feature-based structure: `model.ts`, `service.ts`, `index.ts`.
- Do not put publish/rollback behavior inside the existing releases list module.
- Controller must use `.model()` with named schemas and method chaining.
- Service must not depend on HTTP context; it returns success values or module error objects.
- API errors return stable English `code` values only; do not return Chinese or English display copy.
- Use `@elysia/eden` Treaty for route tests.
- Keep backend responses language-independent; frontend i18n remains responsible for Chinese/English copy.
- Keep package versions in root Bun Catalogs; do not add dependencies.
- Do not implement Nginx config, `current` symlinks, custom domains, Web UI, Desktop UI, approval flow, async deployment jobs, failed deployment records, or project-level publish locks in this plan.
- Repository publish/rollback methods are the atomic boundary; a future PostgreSQL repository must implement them with a transaction.
- Do not commit generated temp folders, `.DS_Store`, `.env.local`, `.tmp-*`, `.codegraph/`, `.superpowers/`, `node_modules`, Electron `out`, or ad-hoc zip files outside committed test fixtures.
- After each task, commit only the files touched by that task.

---

## File Map

- Create: `apps/api/src/modules/deployments/model.ts`
  - TypeBox models, DTO types, route params, request body, success/error models, and deployment service error classes.
- Create: `apps/api/src/modules/deployments/service.ts`
  - Authentication, permission checks, publish/rollback/list business rules, audit recording.
- Create: `apps/api/src/modules/deployments/index.ts`
  - Elysia plugin for publish, rollback, and deployment list routes.
- Modify: `apps/api/src/index.ts`
  - Wire `deploymentsModule({ repository, hashRefreshToken })`.
- Modify: `apps/api/src/modules/auth/repository.ts`
  - Add deployment records, project `currentReleaseId`, active release status support, deployment repository methods, and audit lookup helper for tests.
- Modify: `apps/api/src/modules/projects/model.ts`
  - Add `currentReleaseId: string | null` to `Project`.
- Modify: `apps/api/src/modules/releases/service.ts`
  - Treat `active` release like `ready` for `previewUrl`.
- Modify: `apps/api/src/modules/site-preview/service.ts`
  - Allow active release previews through repository lookup.
- Create: `tests/unit/deployments-routes.test.ts`
  - Publish, rollback, permissions, deployment list, audit assertions.
- Modify: `tests/unit/releases-routes.test.ts`
  - Assert active release still returns `previewUrl`.
- Modify: `tests/unit/site-preview-routes.test.ts`
  - Assert active release can still be served by `/_sites/:projectSlug/:releaseHash/`.
- Modify: `docs/02-技术架构.md`
  - Document publish/rollback control plane and active preview behavior.
- Modify: `docs/03-测试规范与实施路线.md`
  - Mark Phase 5 backend control-plane scope and keep Nginx access-plane work separate.

---

### Task 1: Publish Happy Path Contract

**Files:**
- Create: `tests/unit/deployments-routes.test.ts`
- Create: `apps/api/src/modules/deployments/model.ts`
- Create: `apps/api/src/modules/deployments/service.ts`
- Create: `apps/api/src/modules/deployments/index.ts`
- Modify: `apps/api/src/index.ts`
- Modify: `apps/api/src/modules/auth/repository.ts`
- Modify: `apps/api/src/modules/projects/model.ts`

**Interfaces:**
- Consumes:
  - `createApp(options?: { storageRoot?: string; exposeTestRoutes?: boolean })`
  - `hashRefreshToken(token: string): Promise<string>`
  - `AuditService.record(input)`
  - `PermissionService.can(role, "publish_release")`
- Produces:
  - `deploymentsModule(options: DeploymentsModuleOptions)`
  - `DeploymentsService.publish(headers, params, body)`
  - `DeploymentsRepository.publishRelease(input): Promise<DeploymentMutationResult>`
  - `Project.currentReleaseId: string | null`
  - `Deployment` DTO

- [ ] **Step 1: Write the failing publish happy path test**

Create `tests/unit/deployments-routes.test.ts` with this initial content:

```ts
import { treaty } from "@elysia/eden";
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createApp } from "../../apps/api/src/index";

function createTempStorageRoot() {
  return mkdtempSync(join(tmpdir(), "zipship-api-deployments-"));
}

async function registerLoginAndCreateProject(api = treaty(createApp())) {
  await api._api.auth.register.post({
    name: "Ada Lovelace",
    email: "ada@example.com",
    password: "correct-horse-battery",
  });
  const login = await api._api.auth.login.post({
    email: "ada@example.com",
    password: "correct-horse-battery",
    clientType: "web",
  });
  const refreshToken = login.data?.session.refreshToken ?? "";
  const organizations = await api._api.organizations.get({
    headers: { authorization: `Bearer ${refreshToken}` },
  });
  const organizationId = organizations.data?.organizations[0]?.id ?? "";
  const created = await api._api.organizations({ organizationId }).projects.post(
    {
      name: "Marketing Site",
      slug: `marketing-site-${crypto.randomUUID().slice(0, 8)}`,
      description: "Launch pages",
    },
    {
      headers: { authorization: `Bearer ${refreshToken}` },
    },
  );
  const project = created.data?.project;
  if (!project) throw new Error("Project creation unexpectedly returned no project");

  return { api, refreshToken, project };
}

async function createReadyRelease(api: ReturnType<typeof treaty>, projectId: string, refreshToken: string) {
  const created = await api._api.projects({ projectId }).uploads.post(
    { originalFilename: "dist.zip", size: 1024 },
    { headers: { authorization: `Bearer ${refreshToken}` } },
  );
  const uploadTask = created.data?.uploadTask;
  if (!uploadTask) throw new Error("Upload task creation unexpectedly returned no task");

  const bytes = await Bun.file(
    join(import.meta.dir, "../../packages/deploy-core/tests/fixtures/valid-vite-relative-base.zip"),
  ).arrayBuffer();
  await api._api.uploads({ uploadTaskId: uploadTask.id }).raw.put(
    { file: new File([bytes], "dist.zip", { type: "application/zip" }) },
    { headers: { authorization: `Bearer ${refreshToken}` } },
  );
  await api._api.uploads({ uploadTaskId: uploadTask.id }).complete.post(null, {
    headers: { authorization: `Bearer ${refreshToken}` },
  });

  const releases = await api._api.projects({ projectId }).releases.get({
    headers: { authorization: `Bearer ${refreshToken}` },
  });
  const release = releases.data?.releases[0];
  if (!release) throw new Error("Release listing unexpectedly returned no release");

  return release;
}

describe("deployments routes", () => {
  test("publishes a ready release and records deployment and audit", async () => {
    const storageRoot = createTempStorageRoot();
    try {
      const api = treaty(createApp({ storageRoot, exposeTestRoutes: true }));
      const { refreshToken, project } = await registerLoginAndCreateProject(api);
      const release = await createReadyRelease(api, project.id, refreshToken);

      const response = await api._api.projects({ projectId: project.id }).releases({ releaseId: release.id }).publish.post(
        { message: "Ship v1" },
        { headers: { authorization: `Bearer ${refreshToken}` } },
      );

      expect(response.status).toBe(200);
      expect(response.data?.deployment).toMatchObject({
        projectId: project.id,
        releaseId: release.id,
        previousReleaseId: null,
        action: "publish",
        status: "success",
        message: "Ship v1",
        operatorId: project.createdBy,
      });
      expect(response.data?.project).toMatchObject({
        id: project.id,
        currentReleaseId: release.id,
      });
      expect(response.data?.release).toMatchObject({
        id: release.id,
        status: "active",
        previewUrl: `/_sites/${project.slug}/${release.releaseHash}/`,
      });
      expect(response.data?.release.activatedAt).toEqual(expect.any(String));
      expect(response.data?.previousRelease).toBeNull();

      const deployments = await api._api.projects({ projectId: project.id }).deployments.get({
        headers: { authorization: `Bearer ${refreshToken}` },
      });
      expect(deployments.status).toBe(200);
      expect(deployments.data?.deployments).toHaveLength(1);
      expect(deployments.data?.deployments[0]).toMatchObject({
        releaseId: release.id,
        action: "publish",
        status: "success",
      });

      const auditResponse = await api._api.__test.auditLogs.get();
      expect(auditResponse.status).toBe(200);
      expect(auditResponse.data?.auditLogs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            projectId: project.id,
            actorId: project.createdBy,
            action: "release.published",
            targetType: "release",
            targetId: release.id,
            metadata: expect.objectContaining({
              releaseId: release.id,
              previousReleaseId: null,
              message: "Ship v1",
            }),
          }),
        ]),
      );
    } finally {
      rmSync(storageRoot, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run the focused test and confirm it fails**

Run:

```bash
bun test tests/unit/deployments-routes.test.ts --test-name-pattern "publishes a ready release"
```

Expected: FAIL because `_api.projects(...).releases(...).publish`, `/_api/__test/auditLogs`, and the `exposeTestRoutes` app option do not exist yet.

- [ ] **Step 3: Add deployment models**

Create `apps/api/src/modules/deployments/model.ts`:

```ts
import { t } from "elysia";
import { projectModel } from "../projects/model";
import { releaseModel } from "../releases/model";

export const deploymentHeadersModel = t.Object({
  authorization: t.Optional(t.String()),
});

export const deploymentProjectParamsModel = t.Object({
  projectId: t.String(),
});

export const deploymentReleaseParamsModel = t.Object({
  projectId: t.String(),
  releaseId: t.String(),
});

export const deploymentBodyModel = t.Object({
  message: t.Nullable(t.Optional(t.String())),
});

export const deploymentModel = t.Object({
  id: t.String(),
  projectId: t.String(),
  releaseId: t.String(),
  previousReleaseId: t.Nullable(t.String()),
  action: t.Union([t.Literal("publish"), t.Literal("rollback")]),
  status: t.Literal("success"),
  operatorId: t.String(),
  message: t.Nullable(t.String()),
  createdAt: t.String(),
  finishedAt: t.Nullable(t.String()),
});

export const deploymentResultModel = t.Object({
  deployment: deploymentModel,
  project: projectModel,
  release: releaseModel,
  previousRelease: t.Nullable(releaseModel),
});

export const deploymentListModel = t.Object({
  deployments: t.Array(deploymentModel),
});

export const deploymentErrorModel = t.Object({
  code: t.Union([
    t.Literal("UNAUTHORIZED"),
    t.Literal("FORBIDDEN"),
    t.Literal("PROJECT_NOT_FOUND"),
    t.Literal("RELEASE_NOT_FOUND"),
    t.Literal("RELEASE_NOT_READY"),
    t.Literal("RELEASE_NOT_ROLLBACKABLE"),
    t.Literal("RELEASE_ALREADY_ACTIVE"),
    t.Literal("VALIDATION_ERROR"),
  ]),
});

export const deploymentModels = {
  "Deployments.Headers": deploymentHeadersModel,
  "Deployments.ProjectParams": deploymentProjectParamsModel,
  "Deployments.ReleaseParams": deploymentReleaseParamsModel,
  "Deployments.Body": deploymentBodyModel,
  "Deployments.Result": deploymentResultModel,
  "Deployments.List": deploymentListModel,
  "Deployments.Error": deploymentErrorModel,
};

export type DeploymentHeaders = typeof deploymentHeadersModel.static;
export type DeploymentProjectParams = typeof deploymentProjectParamsModel.static;
export type DeploymentReleaseParams = typeof deploymentReleaseParamsModel.static;
export type DeploymentBody = typeof deploymentBodyModel.static;
export type Deployment = typeof deploymentModel.static;
export type DeploymentResult = typeof deploymentResultModel.static;
export type DeploymentList = typeof deploymentListModel.static;
export type DeploymentErrorCode = typeof deploymentErrorModel.static.code;

export class DeploymentServiceError {
  constructor(public readonly code: DeploymentErrorCode) {}
}

export class DeploymentUnauthorizedError extends DeploymentServiceError {
  constructor() {
    super("UNAUTHORIZED");
  }
}

export class DeploymentForbiddenError extends DeploymentServiceError {
  constructor() {
    super("FORBIDDEN");
  }
}

export class DeploymentProjectNotFoundError extends DeploymentServiceError {
  constructor() {
    super("PROJECT_NOT_FOUND");
  }
}

export class DeploymentReleaseNotFoundError extends DeploymentServiceError {
  constructor() {
    super("RELEASE_NOT_FOUND");
  }
}

export class DeploymentReleaseNotReadyError extends DeploymentServiceError {
  constructor() {
    super("RELEASE_NOT_READY");
  }
}

export class DeploymentReleaseNotRollbackableError extends DeploymentServiceError {
  constructor() {
    super("RELEASE_NOT_ROLLBACKABLE");
  }
}

export class DeploymentReleaseAlreadyActiveError extends DeploymentServiceError {
  constructor() {
    super("RELEASE_ALREADY_ACTIVE");
  }
}
```

- [ ] **Step 4: Add `currentReleaseId` to project DTO**

Modify `apps/api/src/modules/projects/model.ts`:

```ts
export const projectModel = t.Object({
  id: t.String(),
  organizationId: t.String(),
  name: t.String(),
  slug: t.String(),
  description: t.Nullable(t.String()),
  currentReleaseId: t.Nullable(t.String()),
  status: t.Literal("active"),
  visibility: t.Literal("private"),
  createdBy: t.String(),
  createdAt: t.String(),
  updatedAt: t.String(),
});
```

- [ ] **Step 5: Add publish service**

Create `apps/api/src/modules/deployments/service.ts`:

```ts
import { AuditService } from "../audit/service";
import type { AuditRepository } from "../audit/service";
import type { MemberRole } from "../permissions/model";
import { PermissionService } from "../permissions/service";
import type { Project } from "../projects/model";
import type { Release } from "../releases/model";
import {
  DeploymentForbiddenError,
  DeploymentProjectNotFoundError,
  DeploymentReleaseNotFoundError,
  DeploymentReleaseNotReadyError,
  DeploymentServiceError,
  DeploymentUnauthorizedError,
} from "./model";
import type {
  Deployment,
  DeploymentBody,
  DeploymentHeaders,
  DeploymentList,
  DeploymentProjectParams,
  DeploymentReleaseParams,
  DeploymentResult,
} from "./model";

interface CurrentSession {
  user: {
    id: string;
    name: string;
    email: string;
  };
  session: {
    id: string;
    clientType: "web" | "desktop";
    expiresAt: string;
  };
}

export interface DeploymentMutationResult {
  deployment: Deployment;
  project: Project;
  release: Release;
  previousRelease: Release | null;
}

export interface DeploymentsRepository extends AuditRepository {
  findSessionByRefreshTokenHash(refreshTokenHash: string, now: Date): Promise<CurrentSession | null>;
  findProjectById(projectId: string): Promise<Project | null>;
  findMembership(input: {
    organizationId: string;
    userId: string;
  }): Promise<{ role: MemberRole } | null>;
  findReleaseById(releaseId: string): Promise<Release | null>;
  listDeploymentsForProject(projectId: string): Promise<Deployment[]>;
  publishRelease(input: {
    projectId: string;
    releaseId: string;
    operatorId: string;
    message: string | null;
    now: Date;
  }): Promise<DeploymentMutationResult>;
  rollbackRelease(input: {
    projectId: string;
    releaseId: string;
    operatorId: string;
    message: string | null;
    now: Date;
  }): Promise<DeploymentMutationResult>;
}

export interface DeploymentsServiceOptions {
  repository: DeploymentsRepository;
  hashRefreshToken: (token: string) => Promise<string>;
  now: () => Date;
  permissions?: PermissionService;
  audit?: AuditService;
}

export class DeploymentsService {
  private readonly permissions: PermissionService;
  private readonly audit: AuditService;

  constructor(private readonly options: DeploymentsServiceOptions) {
    this.permissions = options.permissions ?? new PermissionService();
    this.audit =
      options.audit ??
      new AuditService({
        repository: options.repository,
        now: options.now,
      });
  }

  async publish(
    headers: DeploymentHeaders,
    params: DeploymentReleaseParams,
    body: DeploymentBody,
  ): Promise<DeploymentResult | DeploymentServiceError> {
    const currentUser = await this.requireCurrentUser(headers);
    if (currentUser instanceof DeploymentServiceError) return currentUser;

    const project = await this.options.repository.findProjectById(params.projectId);
    if (!project) return new DeploymentProjectNotFoundError();

    const membership = await this.options.repository.findMembership({
      organizationId: project.organizationId,
      userId: currentUser.user.id,
    });
    if (!membership) return new DeploymentForbiddenError();
    if (!this.permissions.can(membership.role, "publish_release")) return new DeploymentForbiddenError();

    const release = await this.options.repository.findReleaseById(params.releaseId);
    if (!release || release.projectId !== project.id) return new DeploymentReleaseNotFoundError();
    if (release.status !== "ready" || release.archivedAt !== null) return new DeploymentReleaseNotReadyError();

    const result = await this.options.repository.publishRelease({
      projectId: project.id,
      releaseId: release.id,
      operatorId: currentUser.user.id,
      message: normalizeMessage(body.message),
      now: this.options.now(),
    });

    await this.audit.record({
      organizationId: project.organizationId,
      projectId: project.id,
      actorId: currentUser.user.id,
      action: "release.published",
      targetType: "release",
      targetId: release.id,
      metadata: {
        releaseId: release.id,
        previousReleaseId: result.deployment.previousReleaseId,
        deploymentId: result.deployment.id,
        message: result.deployment.message,
      },
    });

    return result;
  }

  async list(
    headers: DeploymentHeaders,
    params: DeploymentProjectParams,
  ): Promise<DeploymentList | DeploymentServiceError> {
    const currentUser = await this.requireCurrentUser(headers);
    if (currentUser instanceof DeploymentServiceError) return currentUser;

    const project = await this.options.repository.findProjectById(params.projectId);
    if (!project) return new DeploymentProjectNotFoundError();

    const membership = await this.options.repository.findMembership({
      organizationId: project.organizationId,
      userId: currentUser.user.id,
    });
    if (!membership) return new DeploymentForbiddenError();
    if (!this.permissions.can(membership.role, "view_project")) return new DeploymentForbiddenError();

    return {
      deployments: await this.options.repository.listDeploymentsForProject(project.id),
    };
  }

  private async requireCurrentUser(headers: DeploymentHeaders) {
    const refreshToken = parseBearerToken(headers.authorization);
    if (!refreshToken) return new DeploymentUnauthorizedError();

    const currentSession = await this.options.repository.findSessionByRefreshTokenHash(
      await this.options.hashRefreshToken(refreshToken),
      this.options.now(),
    );
    if (!currentSession) return new DeploymentUnauthorizedError();

    return currentSession;
  }
}

function normalizeMessage(message: string | null | undefined): string | null {
  const normalized = message?.trim();
  return normalized ? normalized : null;
}

function parseBearerToken(authorization: string | undefined): string | null {
  if (!authorization) return null;
  const [scheme, token] = authorization.split(" ");
  if (scheme !== "Bearer" || !token) return null;
  return token;
}
```

- [ ] **Step 6: Add deployment controller**

Create `apps/api/src/modules/deployments/index.ts`:

```ts
import { Elysia } from "elysia";
import { deploymentModels, DeploymentServiceError } from "./model";
import { DeploymentsService } from "./service";
import type { DeploymentsRepository } from "./service";

export interface DeploymentsModuleOptions {
  repository: DeploymentsRepository;
  hashRefreshToken: (token: string) => Promise<string>;
}

export function deploymentsModule(options: DeploymentsModuleOptions) {
  const deployments = new DeploymentsService({
    repository: options.repository,
    hashRefreshToken: options.hashRefreshToken,
    now: () => new Date(),
  });

  return new Elysia({ name: "deployments", prefix: "/_api/projects/:projectId" })
    .model(deploymentModels)
    .onError(({ code, status }) => {
      if (code === "VALIDATION") {
        return status(400, { code: "VALIDATION_ERROR" as const });
      }
    })
    .post(
      "/releases/:releaseId/publish",
      async ({ headers, params, body, status }) => {
        const result = await deployments.publish(headers, params, body);
        if (result instanceof DeploymentServiceError) {
          return status(toStatusCode(result.code), { code: result.code });
        }
        return result;
      },
      {
        headers: "Deployments.Headers",
        params: "Deployments.ReleaseParams",
        body: "Deployments.Body",
        response: {
          200: "Deployments.Result",
          400: "Deployments.Error",
          401: "Deployments.Error",
          403: "Deployments.Error",
          404: "Deployments.Error",
          409: "Deployments.Error",
        },
      },
    )
    .get(
      "/deployments",
      async ({ headers, params, status }) => {
        const result = await deployments.list(headers, params);
        if (result instanceof DeploymentServiceError) {
          return status(toStatusCode(result.code), { code: result.code });
        }
        return result;
      },
      {
        headers: "Deployments.Headers",
        params: "Deployments.ProjectParams",
        response: {
          200: "Deployments.List",
          400: "Deployments.Error",
          401: "Deployments.Error",
          403: "Deployments.Error",
          404: "Deployments.Error",
        },
      },
    );
}

function toStatusCode(code: string): 401 | 403 | 404 | 409 {
  if (code === "UNAUTHORIZED") return 401;
  if (code === "FORBIDDEN") return 403;
  if (code === "PROJECT_NOT_FOUND" || code === "RELEASE_NOT_FOUND") return 404;
  return 409;
}
```

- [ ] **Step 7: Wire the module into the app**

Modify `apps/api/src/index.ts`:

```ts
import { deploymentsModule } from "./modules/deployments";
```

Extend `CreateAppOptions`:

```ts
export interface CreateAppOptions {
  storageRoot?: string;
  exposeTestRoutes?: boolean;
}
```

Add it after `releasesModule` and before upload modules:

```ts
.use(releasesModule({ repository, hashRefreshToken }))
.use(deploymentsModule({ repository, hashRefreshToken }))
.use(uploadsModule({ repository, hashRefreshToken, storagePaths }))
```

- [ ] **Step 8: Extend the in-memory repository data model**

Modify `apps/api/src/modules/auth/repository.ts`.

Add import:

```ts
import type { Deployment } from "../deployments/model";
import type { DeploymentsRepository } from "../deployments/service";
```

Add `DeploymentsRepository` to the return type intersection:

```ts
export function createInMemoryAuthRepository(): AuthRepository &
  OrganizationsRepository &
  AuditRepository &
  ProjectsRepository &
  ReleasesRepository &
  UploadsRepository &
  SitePreviewRepository &
  DeploymentsRepository {
```

Change `ProjectRecord`:

```ts
interface ProjectRecord {
  id: string;
  organizationId: string;
  name: string;
  slug: string;
  description: string | null;
  currentReleaseId: string | null;
  status: "active";
  visibility: "private";
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}
```

Change `ReleaseRecord.status`:

```ts
status: "uploading" | "processing" | "ready" | "active" | "failed" | "archived" | "deleted";
```

Add a deployment record interface:

```ts
interface DeploymentRecord {
  id: string;
  projectId: string;
  releaseId: string;
  previousReleaseId: string | null;
  action: "publish" | "rollback";
  status: "success";
  operatorId: string;
  message: string | null;
  createdAt: Date;
  finishedAt: Date | null;
}
```

Add a map near the other maps:

```ts
const deployments = new Map<string, DeploymentRecord>();
```

When creating a project, set:

```ts
currentReleaseId: null,
```

- [ ] **Step 9: Add repository methods for publish, deployment list, and test audit logs**

Add these methods inside the returned repository object in `apps/api/src/modules/auth/repository.ts`:

```ts
async findReleaseById(releaseId) {
  const release = releases.get(releaseId);
  return release ? toRelease(release) : null;
},

async listDeploymentsForProject(projectId) {
  return Array.from(deployments.values())
    .filter((deployment) => deployment.projectId === projectId)
    .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
    .map(toDeployment);
},

async publishRelease(input) {
  return mutateCurrentRelease({
    projects,
    releases,
    deployments,
    projectId: input.projectId,
    releaseId: input.releaseId,
    operatorId: input.operatorId,
    message: input.message,
    action: "publish",
    now: input.now,
  });
},

async rollbackRelease(input) {
  return mutateCurrentRelease({
    projects,
    releases,
    deployments,
    projectId: input.projectId,
    releaseId: input.releaseId,
    operatorId: input.operatorId,
    message: input.message,
    action: "rollback",
    now: input.now,
  });
},

async listAuditLogsForTest() {
  return Array.from(auditLogs.values())
    .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())
    .map(toAuditLog);
},
```

Add helper functions below `createPendingReleaseHash`:

```ts
function mutateCurrentRelease(input: {
  projects: Map<string, ProjectRecord>;
  releases: Map<string, ReleaseRecord>;
  deployments: Map<string, DeploymentRecord>;
  projectId: string;
  releaseId: string;
  operatorId: string;
  message: string | null;
  action: "publish" | "rollback";
  now: Date;
}) {
  const project = input.projects.get(input.projectId);
  const release = input.releases.get(input.releaseId);
  if (!project) throw new Error("Project not found");
  if (!release) throw new Error("Release not found");

  const previousReleaseId = project.currentReleaseId;
  const previousRelease = previousReleaseId ? input.releases.get(previousReleaseId) ?? null : null;

  if (previousRelease && previousRelease.id !== release.id && previousRelease.status === "active") {
    previousRelease.status = "ready";
    input.releases.set(previousRelease.id, previousRelease);
  }

  release.status = "active";
  release.activatedAt = input.now;
  input.releases.set(release.id, release);

  project.currentReleaseId = release.id;
  project.updatedAt = input.now;
  input.projects.set(project.id, project);

  const deployment: DeploymentRecord = {
    id: crypto.randomUUID(),
    projectId: project.id,
    releaseId: release.id,
    previousReleaseId,
    action: input.action,
    status: "success",
    operatorId: input.operatorId,
    message: input.message,
    createdAt: input.now,
    finishedAt: input.now,
  };
  input.deployments.set(deployment.id, deployment);

  return {
    deployment: toDeployment(deployment),
    project: toProject(project),
    release: toRelease(release),
    previousRelease: previousRelease ? toRelease(previousRelease) : null,
  };
}
```

Update `toProject`:

```ts
function toProject(record: ProjectRecord): Project {
  return {
    id: record.id,
    organizationId: record.organizationId,
    name: record.name,
    slug: record.slug,
    description: record.description,
    currentReleaseId: record.currentReleaseId,
    status: record.status,
    visibility: record.visibility,
    createdBy: record.createdBy,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}
```

Add `toDeployment`:

```ts
function toDeployment(record: DeploymentRecord): Deployment {
  return {
    id: record.id,
    projectId: record.projectId,
    releaseId: record.releaseId,
    previousReleaseId: record.previousReleaseId,
    action: record.action,
    status: record.status,
    operatorId: record.operatorId,
    message: record.message,
    createdAt: record.createdAt.toISOString(),
    finishedAt: record.finishedAt?.toISOString() ?? null,
  };
}
```

- [ ] **Step 10: Add the gated test-only audit route**

Modify `apps/api/src/index.ts` so the app starts as a local variable before returning:

```ts
const api = new Elysia().get("/_health", () => ({
  status: "ok",
  service: "zipship-api",
}));

if (options.exposeTestRoutes) {
  api.get("/_api/__test/auditLogs", async () => ({
    auditLogs:
      "listAuditLogsForTest" in repository
        ? await repository.listAuditLogsForTest()
        : [],
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
```

Do not add `/_api/__test/*` routes unless `options.exposeTestRoutes` is true.

The test-only audit route body is:

```ts
api.get("/_api/__test/auditLogs", async () => ({
  auditLogs:
    "listAuditLogsForTest" in repository
      ? await repository.listAuditLogsForTest()
      : [],
}));
```

Keep this route only for tests. It returns stable audit data without exposing it through production-facing modules.

- [ ] **Step 11: Run focused checks**

Run:

```bash
bun test tests/unit/deployments-routes.test.ts --test-name-pattern "publishes a ready release"
bun run --filter @zipship/api typecheck
```

Expected: both commands exit with code 0.

- [ ] **Step 12: Commit**

```bash
git add apps/api/src/index.ts apps/api/src/modules/auth/repository.ts apps/api/src/modules/deployments apps/api/src/modules/projects/model.ts tests/unit/deployments-routes.test.ts
git commit -m "feat: publish ready releases"
```

---

### Task 2: Publish Permissions And Invalid Release States

**Files:**
- Modify: `tests/unit/deployments-routes.test.ts`
- Modify: `apps/api/src/modules/auth/repository.ts`
- Modify: `apps/api/src/modules/deployments/service.ts`

**Interfaces:**
- Consumes:
  - `DeploymentsService.publish(headers, params, body)`
  - `DeploymentsRepository.findReleaseById(releaseId)`
  - `PermissionService.can(role, "publish_release")`
- Produces:
  - Stable publish errors for unauthorized, forbidden, missing release, wrong project, and non-ready release states.
  - Test helper repository method `setMemberRoleForTest(input)`.
  - Test helper repository method `setReleaseStateForTest(input)`.

- [ ] **Step 1: Add failing publish permission tests**

Append these tests to `tests/unit/deployments-routes.test.ts`:

```ts
test("rejects publish without a bearer token", async () => {
  const storageRoot = createTempStorageRoot();
  try {
    const api = treaty(createApp({ storageRoot, exposeTestRoutes: true }));
    const { refreshToken, project } = await registerLoginAndCreateProject(api);
    const release = await createReadyRelease(api, project.id, refreshToken);

    const response = await api._api.projects({ projectId: project.id }).releases({ releaseId: release.id }).publish.post({
      message: null,
    });

    expect(response.status).toBe(401);
    expect((response.error?.value as unknown)).toEqual({ code: "UNAUTHORIZED" });
  } finally {
    rmSync(storageRoot, { recursive: true, force: true });
  }
});

test("rejects publish for developer and viewer roles", async () => {
  const storageRoot = createTempStorageRoot();
  try {
    const app = createApp({ storageRoot, exposeTestRoutes: true });
    const api = treaty(app);
    const { refreshToken, project } = await registerLoginAndCreateProject(api);
    const release = await createReadyRelease(api, project.id, refreshToken);

    await app.handle(
      new Request("http://localhost/_api/__test/memberRole", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: project.createdBy, organizationId: project.organizationId, role: "developer" }),
      }),
    );
    const developerResponse = await api._api.projects({ projectId: project.id }).releases({ releaseId: release.id }).publish.post(
      { message: null },
      { headers: { authorization: `Bearer ${refreshToken}` } },
    );
    expect(developerResponse.status).toBe(403);
    expect((developerResponse.error?.value as unknown)).toEqual({ code: "FORBIDDEN" });

    await app.handle(
      new Request("http://localhost/_api/__test/memberRole", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: project.createdBy, organizationId: project.organizationId, role: "viewer" }),
      }),
    );
    const viewerResponse = await api._api.projects({ projectId: project.id }).releases({ releaseId: release.id }).publish.post(
      { message: null },
      { headers: { authorization: `Bearer ${refreshToken}` } },
    );
    expect(viewerResponse.status).toBe(403);
    expect((viewerResponse.error?.value as unknown)).toEqual({ code: "FORBIDDEN" });
  } finally {
    rmSync(storageRoot, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Add failing invalid release tests**

Append:

```ts
test("rejects publish for unknown project, unknown release, and release from another project", async () => {
  const storageRoot = createTempStorageRoot();
  try {
    const api = treaty(createApp({ storageRoot, exposeTestRoutes: true }));
    const first = await registerLoginAndCreateProject(api);
    const second = await registerLoginAndCreateProject(api);
    const otherRelease = await createReadyRelease(api, second.project.id, second.refreshToken);

    const unknownProject = await api._api.projects({ projectId: "missing-project" }).releases({ releaseId: otherRelease.id }).publish.post(
      { message: null },
      { headers: { authorization: `Bearer ${first.refreshToken}` } },
    );
    expect(unknownProject.status).toBe(404);
    expect((unknownProject.error?.value as unknown)).toEqual({ code: "PROJECT_NOT_FOUND" });

    const unknownRelease = await api._api.projects({ projectId: first.project.id }).releases({ releaseId: "missing-release" }).publish.post(
      { message: null },
      { headers: { authorization: `Bearer ${first.refreshToken}` } },
    );
    expect(unknownRelease.status).toBe(404);
    expect((unknownRelease.error?.value as unknown)).toEqual({ code: "RELEASE_NOT_FOUND" });

    const wrongProject = await api._api.projects({ projectId: first.project.id }).releases({ releaseId: otherRelease.id }).publish.post(
      { message: null },
      { headers: { authorization: `Bearer ${first.refreshToken}` } },
    );
    expect(wrongProject.status).toBe(404);
    expect((wrongProject.error?.value as unknown)).toEqual({ code: "RELEASE_NOT_FOUND" });
  } finally {
    rmSync(storageRoot, { recursive: true, force: true });
  }
});

test("rejects publish for releases that are not ready or are archived", async () => {
  const storageRoot = createTempStorageRoot();
  try {
    const app = createApp({ storageRoot, exposeTestRoutes: true });
    const api = treaty(app);
    const { refreshToken, project } = await registerLoginAndCreateProject(api);
    const release = await createReadyRelease(api, project.id, refreshToken);

    for (const statusValue of ["uploading", "processing", "failed", "archived", "deleted"] as const) {
      await app.handle(
        new Request("http://localhost/_api/__test/releaseState", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ releaseId: release.id, status: statusValue, archived: false }),
        }),
      );
      const response = await api._api.projects({ projectId: project.id }).releases({ releaseId: release.id }).publish.post(
        { message: null },
        { headers: { authorization: `Bearer ${refreshToken}` } },
      );
      expect(response.status).toBe(409);
      expect((response.error?.value as unknown)).toEqual({ code: "RELEASE_NOT_READY" });
    }

    await app.handle(
      new Request("http://localhost/_api/__test/releaseState", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ releaseId: release.id, status: "ready", archived: true }),
      }),
    );
    const archivedResponse = await api._api.projects({ projectId: project.id }).releases({ releaseId: release.id }).publish.post(
      { message: null },
      { headers: { authorization: `Bearer ${refreshToken}` } },
    );
    expect(archivedResponse.status).toBe(409);
    expect((archivedResponse.error?.value as unknown)).toEqual({ code: "RELEASE_NOT_READY" });
  } finally {
    rmSync(storageRoot, { recursive: true, force: true });
  }
});
```

- [ ] **Step 3: Run tests and confirm failure**

Run:

```bash
bun test tests/unit/deployments-routes.test.ts --test-name-pattern "rejects publish"
```

Expected: FAIL because test helper routes do not exist and non-ready state support is incomplete.

- [ ] **Step 4: Add test helper routes**

Modify `apps/api/src/index.ts` by adding these routes inside the same `if (options.exposeTestRoutes)` block as `/_api/__test/auditLogs`:

```ts
.put("/_api/__test/memberRole", async ({ body }) => {
  if ("setMemberRoleForTest" in repository) {
    await repository.setMemberRoleForTest(body as { organizationId: string; userId: string; role: "owner" | "admin" | "developer" | "deployer" | "viewer" });
  }
  return { ok: true };
})
.put("/_api/__test/releaseState", async ({ body }) => {
  if ("setReleaseStateForTest" in repository) {
    await repository.setReleaseStateForTest(
      body as {
        releaseId: string;
        status: "uploading" | "processing" | "ready" | "active" | "failed" | "archived" | "deleted";
        archived: boolean;
      },
    );
  }
  return { ok: true };
})
```

- [ ] **Step 5: Add helper repository methods**

Add to the returned object in `apps/api/src/modules/auth/repository.ts`:

```ts
async setMemberRoleForTest(input) {
  const member = Array.from(members.values()).find(
    (candidate) => candidate.organizationId === input.organizationId && candidate.userId === input.userId,
  );
  if (!member) throw new Error("Member not found");
  member.role = input.role;
  members.set(member.id, member);
},

async setReleaseStateForTest(input) {
  const release = releases.get(input.releaseId);
  if (!release) throw new Error("Release not found");
  release.status = input.status;
  release.archivedAt = input.archived ? new Date("2026-07-05T00:00:00.000Z") : null;
  releases.set(release.id, release);
},
```

- [ ] **Step 6: Verify publish service returns stable errors**

Ensure `DeploymentsService.publish()` has these checks in this order:

```ts
if (!project) return new DeploymentProjectNotFoundError();
if (!membership) return new DeploymentForbiddenError();
if (!this.permissions.can(membership.role, "publish_release")) return new DeploymentForbiddenError();
if (!release || release.projectId !== project.id) return new DeploymentReleaseNotFoundError();
if (release.status !== "ready" || release.archivedAt !== null) return new DeploymentReleaseNotReadyError();
```

- [ ] **Step 7: Run focused checks**

Run:

```bash
bun test tests/unit/deployments-routes.test.ts --test-name-pattern "rejects publish"
bun test tests/unit/deployments-routes.test.ts --test-name-pattern "publishes a ready release"
bun run --filter @zipship/api typecheck
```

Expected: all commands exit with code 0.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/index.ts apps/api/src/modules/auth/repository.ts apps/api/src/modules/deployments/service.ts tests/unit/deployments-routes.test.ts
git commit -m "test: cover publish authorization failures"
```

---

### Task 3: Replacement Publish And Active Preview

**Files:**
- Modify: `tests/unit/deployments-routes.test.ts`
- Modify: `tests/unit/releases-routes.test.ts`
- Modify: `tests/unit/site-preview-routes.test.ts`
- Modify: `apps/api/src/modules/releases/service.ts`
- Modify: `apps/api/src/modules/site-preview/service.ts`
- Modify: `apps/api/src/modules/auth/repository.ts`

**Interfaces:**
- Consumes:
  - `DeploymentsRepository.publishRelease(input)`
  - `ReleasesService.list(headers, params)`
  - `SitePreviewRepository.findReadyReleaseByProjectIdAndHash(input)`
- Produces:
  - Publishing a second ready release moves the previous active release back to ready.
  - Active releases keep `previewUrl`.
  - `/_sites/:projectSlug/:releaseHash/` serves active releases.

- [ ] **Step 1: Add failing replacement publish test**

Append to `tests/unit/deployments-routes.test.ts`:

```ts
test("publishing a second release moves the previous active release back to ready", async () => {
  const storageRoot = createTempStorageRoot();
  try {
      const api = treaty(createApp({ storageRoot, exposeTestRoutes: true }));
    const { refreshToken, project } = await registerLoginAndCreateProject(api);
    const firstRelease = await createReadyRelease(api, project.id, refreshToken);
    const secondRelease = await createReadyRelease(api, project.id, refreshToken);

    await api._api.projects({ projectId: project.id }).releases({ releaseId: firstRelease.id }).publish.post(
      { message: "Ship v1" },
      { headers: { authorization: `Bearer ${refreshToken}` } },
    );
    const response = await api._api.projects({ projectId: project.id }).releases({ releaseId: secondRelease.id }).publish.post(
      { message: "Ship v2" },
      { headers: { authorization: `Bearer ${refreshToken}` } },
    );

    expect(response.status).toBe(200);
    expect(response.data?.deployment.previousReleaseId).toBe(firstRelease.id);
    expect(response.data?.release).toMatchObject({
      id: secondRelease.id,
      status: "active",
    });
    expect(response.data?.previousRelease).toMatchObject({
      id: firstRelease.id,
      status: "ready",
    });

    const releases = await api._api.projects({ projectId: project.id }).releases.get({
      headers: { authorization: `Bearer ${refreshToken}` },
    });
    const firstAfter = releases.data?.releases.find((candidate) => candidate.id === firstRelease.id);
    const secondAfter = releases.data?.releases.find((candidate) => candidate.id === secondRelease.id);
    expect(firstAfter?.status).toBe("ready");
    expect(secondAfter?.status).toBe("active");
  } finally {
    rmSync(storageRoot, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Add failing active preview tests**

Append to `tests/unit/releases-routes.test.ts`:

```ts
test("returns previewUrl for active releases", async () => {
  const { api, storageRoot, refreshToken, project, uploadTask } = await createCompletedUpload();
  try {
    const releasesBeforePublish = await api._api.projects({ projectId: project.id }).releases.get({
      headers: { authorization: `Bearer ${refreshToken}` },
    });
    const release = releasesBeforePublish.data?.releases[0];
    if (!release) throw new Error("Expected ready release before publish");

    await api._api.projects({ projectId: project.id }).releases({ releaseId: release.id }).publish.post(
      { message: "Ship v1" },
      { headers: { authorization: `Bearer ${refreshToken}` } },
    );

    const releasesAfterPublish = await api._api.projects({ projectId: project.id }).releases.get({
      headers: { authorization: `Bearer ${refreshToken}` },
    });
    const activeRelease = releasesAfterPublish.data?.releases.find((candidate) => candidate.id === uploadTask.releaseId);
    expect(activeRelease?.status).toBe("active");
    expect(activeRelease?.previewUrl).toBe(`/_sites/${project.slug}/${release.releaseHash}/`);
  } finally {
    rmSync(storageRoot, { recursive: true, force: true });
  }
});
```

Append to `tests/unit/site-preview-routes.test.ts`:

```ts
test("serves an active release preview after publish", async () => {
  const storageRoot = createTempStorageRoot();
  try {
    const app = createApp({ storageRoot, exposeTestRoutes: true });
    const api = treaty(app);
    const { refreshToken, project } = await registerLoginAndCreateProject(api);
    const created = await api._api.projects({ projectId: project.id }).uploads.post(
      { originalFilename: "dist.zip", size: 1024 },
      { headers: { authorization: `Bearer ${refreshToken}` } },
    );
    const uploadTask = created.data?.uploadTask;
    if (!uploadTask) throw new Error("Upload task creation unexpectedly returned no task");

    const bytes = await Bun.file(join(import.meta.dir, "../../packages/deploy-core/tests/fixtures/valid-vite-relative-base.zip")).arrayBuffer();
    await api._api.uploads({ uploadTaskId: uploadTask.id }).raw.put(
      { file: new File([bytes], "dist.zip", { type: "application/zip" }) },
      { headers: { authorization: `Bearer ${refreshToken}` } },
    );
    await api._api.uploads({ uploadTaskId: uploadTask.id }).complete.post(null, {
      headers: { authorization: `Bearer ${refreshToken}` },
    });
    const releases = await api._api.projects({ projectId: project.id }).releases.get({
      headers: { authorization: `Bearer ${refreshToken}` },
    });
    const release = releases.data?.releases[0];
    if (!release) throw new Error("Expected release listing to contain release");

    await api._api.projects({ projectId: project.id }).releases({ releaseId: release.id }).publish.post(
      { message: "Ship v1" },
      { headers: { authorization: `Bearer ${refreshToken}` } },
    );

    const response = await app.handle(new Request(`http://localhost/_sites/${project.slug}/${release.releaseHash}/`));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(await response.text()).toContain("./assets/index.js");
  } finally {
    rmSync(storageRoot, { recursive: true, force: true });
  }
});
```

- [ ] **Step 3: Run tests and confirm failure**

Run:

```bash
bun test tests/unit/deployments-routes.test.ts --test-name-pattern "publishing a second release"
bun test tests/unit/releases-routes.test.ts --test-name-pattern "active releases"
bun test tests/unit/site-preview-routes.test.ts --test-name-pattern "active release preview"
```

Expected: at least the active preview tests fail because `previewUrl` and site preview currently only treat `ready` as previewable.

- [ ] **Step 4: Update release list preview URL behavior**

Modify `apps/api/src/modules/releases/service.ts`:

```ts
previewUrl:
  isPreviewableRelease(release)
    ? `/_sites/${project.slug}/${release.releaseHash}/`
    : null,
```

Add helper:

```ts
function isPreviewableRelease(release: Release): boolean {
  return (release.status === "ready" || release.status === "active") && release.archivedAt === null;
}
```

- [ ] **Step 5: Update site preview repository and service naming**

Modify `apps/api/src/modules/site-preview/service.ts`.

Rename repository method:

```ts
findPreviewableReleaseByProjectIdAndHash(input: {
  projectId: string;
  releaseHash: string;
}): Promise<Release | null>;
```

Use it in `SitePreviewService.resolve()`:

```ts
const release = await this.options.repository.findPreviewableReleaseByProjectIdAndHash({
  projectId: project.id,
  releaseHash: params.releaseHash,
});
```

Modify `apps/api/src/modules/auth/repository.ts` by replacing `findReadyReleaseByProjectIdAndHash` with:

```ts
async findPreviewableReleaseByProjectIdAndHash(input) {
  const release = Array.from(releases.values()).find(
    (candidate) =>
      candidate.projectId === input.projectId &&
      candidate.releaseHash === input.releaseHash &&
      (candidate.status === "ready" || candidate.status === "active") &&
      candidate.archivedAt === null,
  );

  return release ? toRelease(release) : null;
},
```

- [ ] **Step 6: Run focused checks**

Run:

```bash
bun test tests/unit/deployments-routes.test.ts --test-name-pattern "publishing a second release"
bun test tests/unit/releases-routes.test.ts --test-name-pattern "active releases"
bun test tests/unit/site-preview-routes.test.ts --test-name-pattern "active release preview"
bun run --filter @zipship/api typecheck
```

Expected: all commands exit with code 0.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/auth/repository.ts apps/api/src/modules/releases/service.ts apps/api/src/modules/site-preview/service.ts tests/unit/deployments-routes.test.ts tests/unit/releases-routes.test.ts tests/unit/site-preview-routes.test.ts
git commit -m "feat: keep active releases previewable"
```

---

### Task 4: Rollback Contract And Deployment List

**Files:**
- Modify: `tests/unit/deployments-routes.test.ts`
- Modify: `apps/api/src/modules/deployments/index.ts`
- Modify: `apps/api/src/modules/deployments/service.ts`
- Modify: `apps/api/src/modules/auth/repository.ts`

**Interfaces:**
- Consumes:
  - `DeploymentsRepository.rollbackRelease(input)`
  - `DeploymentsRepository.listDeploymentsForProject(projectId)`
  - Existing `deploymentModels`
- Produces:
  - `POST /_api/projects/:projectId/releases/:releaseId/rollback`
  - Rollback audit event `release.rolled_back`
  - Deployment list sorted newest first.

- [ ] **Step 1: Add failing rollback happy path test**

Append to `tests/unit/deployments-routes.test.ts`:

```ts
test("rolls back to a previous ready release and records deployment and audit", async () => {
  const storageRoot = createTempStorageRoot();
  try {
    const api = treaty(createApp({ storageRoot, exposeTestRoutes: true }));
    const { refreshToken, project } = await registerLoginAndCreateProject(api);
    const firstRelease = await createReadyRelease(api, project.id, refreshToken);
    const secondRelease = await createReadyRelease(api, project.id, refreshToken);

    await api._api.projects({ projectId: project.id }).releases({ releaseId: firstRelease.id }).publish.post(
      { message: "Ship v1" },
      { headers: { authorization: `Bearer ${refreshToken}` } },
    );
    await api._api.projects({ projectId: project.id }).releases({ releaseId: secondRelease.id }).publish.post(
      { message: "Ship v2" },
      { headers: { authorization: `Bearer ${refreshToken}` } },
    );

    const response = await api._api.projects({ projectId: project.id }).releases({ releaseId: firstRelease.id }).rollback.post(
      { message: "Back to v1" },
      { headers: { authorization: `Bearer ${refreshToken}` } },
    );

    expect(response.status).toBe(200);
    expect(response.data?.deployment).toMatchObject({
      projectId: project.id,
      releaseId: firstRelease.id,
      previousReleaseId: secondRelease.id,
      action: "rollback",
      status: "success",
      message: "Back to v1",
    });
    expect(response.data?.project.currentReleaseId).toBe(firstRelease.id);
    expect(response.data?.release).toMatchObject({ id: firstRelease.id, status: "active" });
    expect(response.data?.previousRelease).toMatchObject({ id: secondRelease.id, status: "ready" });

    const auditResponse = await api._api.__test.auditLogs.get();
    expect(auditResponse.data?.auditLogs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          projectId: project.id,
          action: "release.rolled_back",
          targetType: "release",
          targetId: firstRelease.id,
          metadata: expect.objectContaining({
            releaseId: firstRelease.id,
            previousReleaseId: secondRelease.id,
            message: "Back to v1",
          }),
        }),
      ]),
    );
  } finally {
    rmSync(storageRoot, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Add failing rollback error tests**

Append:

```ts
test("rejects rollback without permission, to current release, and to non-ready releases", async () => {
  const storageRoot = createTempStorageRoot();
  try {
    const app = createApp({ storageRoot, exposeTestRoutes: true });
    const api = treaty(app);
    const { refreshToken, project } = await registerLoginAndCreateProject(api);
    const firstRelease = await createReadyRelease(api, project.id, refreshToken);
    const secondRelease = await createReadyRelease(api, project.id, refreshToken);

    await api._api.projects({ projectId: project.id }).releases({ releaseId: firstRelease.id }).publish.post(
      { message: "Ship v1" },
      { headers: { authorization: `Bearer ${refreshToken}` } },
    );

    const currentResponse = await api._api.projects({ projectId: project.id }).releases({ releaseId: firstRelease.id }).rollback.post(
      { message: null },
      { headers: { authorization: `Bearer ${refreshToken}` } },
    );
    expect(currentResponse.status).toBe(409);
    expect((currentResponse.error?.value as unknown)).toEqual({ code: "RELEASE_ALREADY_ACTIVE" });

    await app.handle(
      new Request("http://localhost/_api/__test/memberRole", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: project.createdBy, organizationId: project.organizationId, role: "developer" }),
      }),
    );
    const forbiddenResponse = await api._api.projects({ projectId: project.id }).releases({ releaseId: secondRelease.id }).rollback.post(
      { message: null },
      { headers: { authorization: `Bearer ${refreshToken}` } },
    );
    expect(forbiddenResponse.status).toBe(403);
    expect((forbiddenResponse.error?.value as unknown)).toEqual({ code: "FORBIDDEN" });

    await app.handle(
      new Request("http://localhost/_api/__test/memberRole", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: project.createdBy, organizationId: project.organizationId, role: "owner" }),
      }),
    );
    await app.handle(
      new Request("http://localhost/_api/__test/releaseState", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ releaseId: secondRelease.id, status: "failed", archived: false }),
      }),
    );
    const failedResponse = await api._api.projects({ projectId: project.id }).releases({ releaseId: secondRelease.id }).rollback.post(
      { message: null },
      { headers: { authorization: `Bearer ${refreshToken}` } },
    );
    expect(failedResponse.status).toBe(409);
    expect((failedResponse.error?.value as unknown)).toEqual({ code: "RELEASE_NOT_ROLLBACKABLE" });
  } finally {
    rmSync(storageRoot, { recursive: true, force: true });
  }
});
```

- [ ] **Step 3: Add failing deployment list order test**

Append:

```ts
test("lists deployments newest first for project viewers", async () => {
  const storageRoot = createTempStorageRoot();
  try {
    const api = treaty(createApp({ storageRoot, exposeTestRoutes: true }));
    const { refreshToken, project } = await registerLoginAndCreateProject(api);
    const firstRelease = await createReadyRelease(api, project.id, refreshToken);
    const secondRelease = await createReadyRelease(api, project.id, refreshToken);

    await api._api.projects({ projectId: project.id }).releases({ releaseId: firstRelease.id }).publish.post(
      { message: "Ship v1" },
      { headers: { authorization: `Bearer ${refreshToken}` } },
    );
    await api._api.projects({ projectId: project.id }).releases({ releaseId: secondRelease.id }).publish.post(
      { message: "Ship v2" },
      { headers: { authorization: `Bearer ${refreshToken}` } },
    );
    await api._api.projects({ projectId: project.id }).releases({ releaseId: firstRelease.id }).rollback.post(
      { message: "Back to v1" },
      { headers: { authorization: `Bearer ${refreshToken}` } },
    );

    const response = await api._api.projects({ projectId: project.id }).deployments.get({
      headers: { authorization: `Bearer ${refreshToken}` },
    });

    expect(response.status).toBe(200);
    expect(response.data?.deployments.map((deployment) => deployment.action)).toEqual(["rollback", "publish", "publish"]);
    expect(response.data?.deployments[0]?.releaseId).toBe(firstRelease.id);
  } finally {
    rmSync(storageRoot, { recursive: true, force: true });
  }
});
```

- [ ] **Step 4: Run tests and confirm failure**

Run:

```bash
bun test tests/unit/deployments-routes.test.ts --test-name-pattern "rollback|deployments newest"
```

Expected: FAIL because rollback route and service method do not exist yet.

- [ ] **Step 5: Add rollback service method**

Modify `apps/api/src/modules/deployments/service.ts`.

Add imports:

```ts
import {
  DeploymentReleaseAlreadyActiveError,
  DeploymentReleaseNotRollbackableError,
} from "./model";
```

Add method to `DeploymentsService`:

```ts
async rollback(
  headers: DeploymentHeaders,
  params: DeploymentReleaseParams,
  body: DeploymentBody,
): Promise<DeploymentResult | DeploymentServiceError> {
  const currentUser = await this.requireCurrentUser(headers);
  if (currentUser instanceof DeploymentServiceError) return currentUser;

  const project = await this.options.repository.findProjectById(params.projectId);
  if (!project) return new DeploymentProjectNotFoundError();

  const membership = await this.options.repository.findMembership({
    organizationId: project.organizationId,
    userId: currentUser.user.id,
  });
  if (!membership) return new DeploymentForbiddenError();
  if (!this.permissions.can(membership.role, "rollback_release")) return new DeploymentForbiddenError();

  const release = await this.options.repository.findReleaseById(params.releaseId);
  if (!release || release.projectId !== project.id) return new DeploymentReleaseNotFoundError();
  if (release.id === project.currentReleaseId) return new DeploymentReleaseAlreadyActiveError();
  if (release.status !== "ready" || release.archivedAt !== null) return new DeploymentReleaseNotRollbackableError();

  const result = await this.options.repository.rollbackRelease({
    projectId: project.id,
    releaseId: release.id,
    operatorId: currentUser.user.id,
    message: normalizeMessage(body.message),
    now: this.options.now(),
  });

  await this.audit.record({
    organizationId: project.organizationId,
    projectId: project.id,
    actorId: currentUser.user.id,
    action: "release.rolled_back",
    targetType: "release",
    targetId: release.id,
    metadata: {
      releaseId: release.id,
      previousReleaseId: result.deployment.previousReleaseId,
      deploymentId: result.deployment.id,
      message: result.deployment.message,
    },
  });

  return result;
}
```

- [ ] **Step 6: Add rollback route**

Modify `apps/api/src/modules/deployments/index.ts` by adding this `.post()` after the publish route:

```ts
.post(
  "/releases/:releaseId/rollback",
  async ({ headers, params, body, status }) => {
    const result = await deployments.rollback(headers, params, body);
    if (result instanceof DeploymentServiceError) {
      return status(toStatusCode(result.code), { code: result.code });
    }
    return result;
  },
  {
    headers: "Deployments.Headers",
    params: "Deployments.ReleaseParams",
    body: "Deployments.Body",
    response: {
      200: "Deployments.Result",
      400: "Deployments.Error",
      401: "Deployments.Error",
      403: "Deployments.Error",
      404: "Deployments.Error",
      409: "Deployments.Error",
    },
  },
)
```

- [ ] **Step 7: Make deployment ordering stable for equal timestamps**

Modify `listDeploymentsForProject` in `apps/api/src/modules/auth/repository.ts`:

```ts
.sort((left, right) => {
  const timeDifference = right.createdAt.getTime() - left.createdAt.getTime();
  if (timeDifference !== 0) return timeDifference;
  return Array.from(deployments.keys()).indexOf(right.id) - Array.from(deployments.keys()).indexOf(left.id);
})
```

- [ ] **Step 8: Run focused checks**

Run:

```bash
bun test tests/unit/deployments-routes.test.ts --test-name-pattern "rollback|deployments newest"
bun test tests/unit/deployments-routes.test.ts
bun run --filter @zipship/api typecheck
```

Expected: all commands exit with code 0.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/modules/auth/repository.ts apps/api/src/modules/deployments/index.ts apps/api/src/modules/deployments/service.ts tests/unit/deployments-routes.test.ts
git commit -m "feat: rollback releases"
```

---

### Task 5: Documentation And Full Verification

**Files:**
- Modify: `docs/02-技术架构.md`
- Modify: `docs/03-测试规范与实施路线.md`
- Modify: implementation files only if full verification exposes a defect in this plan's changes.

**Interfaces:**
- Consumes:
  - Published routes and behavior from Tasks 1-4.
- Produces:
  - Chinese docs aligned with the implemented release publish/rollback control plane.
  - Fully verified codegraph index.

- [ ] **Step 1: Update architecture docs**

Modify `docs/02-技术架构.md` in the publish flow section so it explicitly says:

```txt
当前实现中，发布与回滚控制面以 projects.currentReleaseId 作为唯一当前版本来源。发布 ready release 后，后端会把目标 release 标记为 active，把旧 active release 退回 ready，写入 deployments 记录，并通过 AuditService 写入 release.published 审计事件。回滚时同样切换 currentReleaseId，写入 rollback deployment 和 release.rolled_back 审计事件。

内部预览地址 /_sites/:projectSlug/:releaseHash/ 同时支持 ready 和 active release。正式访问地址 /:slug/、/:slug/:hash/、Nginx current 软链接和 routing tests 仍属于后续访问面计划。
```

- [ ] **Step 2: Update testing and roadmap docs**

Modify `docs/03-测试规范与实施路线.md` under Phase 5 so it reads:

```txt
✓ 发布 release API
✓ 回滚 release API
✓ projects.currentReleaseId 控制面切换
✓ release ready / active 状态流转
✓ deployment 记录
✓ audit_log 记录 release.published / release.rolled_back
项目发布锁
current 软链接切换
Nginx 正式访问联动
```

Keep Phase 4 Nginx access-plane items separate. Do not mark Nginx routing tests complete in this task.

- [ ] **Step 3: Run focused deployment tests**

Run:

```bash
bun test tests/unit/deployments-routes.test.ts
```

Expected: all tests in `tests/unit/deployments-routes.test.ts` pass.

- [ ] **Step 4: Run related regression tests**

Run:

```bash
bun test tests/unit/releases-routes.test.ts tests/unit/site-preview-routes.test.ts tests/unit/projects-routes.test.ts tests/unit/permissions.test.ts
```

Expected: all listed tests pass.

- [ ] **Step 5: Run full verification**

Run:

```bash
bun test
bun test --coverage
bun run typecheck
bun run db:generate
```

Expected:

- `bun test` exits with code 0.
- `bun test --coverage` exits with code 0.
- `bun run typecheck` exits with code 0.
- `bun run db:generate` exits with code 0 and does not create an unexpected migration. If it creates a migration, inspect it; because this plan does not change `packages/db/src/schema.ts`, a generated migration indicates a drift problem that must be fixed before committing.

- [ ] **Step 6: Sync CodeGraph**

Run:

```bash
codegraph sync .
```

Expected: command exits with code 0.

- [ ] **Step 7: Check for untracked junk**

Run:

```bash
git ls-files --others --exclude-standard
find . \( -name '.DS_Store' -o -name '.env.local' -o -name '.tmp-*' -o -name '*.tgz' \) -print
```

Expected: no untracked application junk. Committed fixture zip files under `packages/deploy-core/tests/fixtures/` are allowed; new ad-hoc zip files are not.

- [ ] **Step 8: Commit**

```bash
git add docs/02-技术架构.md docs/03-测试规范与实施路线.md
git commit -m "docs: document release publish rollback"
```

If verification required implementation fixes, include only the directly related fixed files in this commit and mention the verification fix in the commit message:

```bash
git add docs/02-技术架构.md docs/03-测试规范与实施路线.md apps/api/src/modules/deployments/service.ts
git commit -m "fix: verify release publish rollback"
```

---

## Final Review Checklist For Deepseek-Flash

- [ ] Every task started with a failing test and the failure was observed.
- [ ] No route returns user-facing Chinese or English display copy from the backend.
- [ ] `developer`, `viewer`, non-member, and unauthenticated users cannot publish or rollback.
- [ ] `owner`, `admin`, and `deployer` can publish and rollback.
- [ ] `Project.currentReleaseId` changes on publish and rollback.
- [ ] Only one release is `active` for a project after publish or rollback.
- [ ] Old active release returns to `ready`.
- [ ] Deployment `previousReleaseId` is the value before the switch.
- [ ] Audit metadata includes `releaseId`, `previousReleaseId`, `deploymentId`, and `message`.
- [ ] Active releases keep `previewUrl` and site preview access.
- [ ] Full verification commands passed.
- [ ] CodeGraph was synced.
- [ ] No hidden temp files, package archives, or ad-hoc zip files were left untracked.
