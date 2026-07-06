# PostgreSQL Drizzle Repositories Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace in-memory `Map`-based storage with PostgreSQL-backed Drizzle ORM repositories across all API modules.

**Architecture:** Each API module gets its own `drizzle-repository.ts` implementing the module's repository interface. The in-memory `createInMemoryAuthRepository()` is kept but unused in production. Module plugin signatures change from receiving a single combined `{ repository }` to receiving multiple specific repositories, enabling true interface segregation.

**Tech Stack:** Drizzle ORM (`drizzle-orm/node-postgres`), `pg` (node-postgres driver), PostgreSQL 17 (via Docker Compose), Bun test with database truncation isolation.

## Global Constraints

- `drizzle-orm` version from root catalog (^0.45.2), `pg` added as new dependency
- All new repo files use factory function pattern: `createDrizzleXxxRepository(db)` — no classes
- `createInMemoryAuthRepository()` in `auth/repository.ts` is retained, not deleted
- Test isolation uses `TRUNCATE TABLE ... CASCADE` in `beforeEach`
- Drizzle schema imported as `import * as schema from "@zipship/db"`
- Docker Compose PostgreSQL 17-alpine on port 5432

---

### Task 1: Foundation — DB Infrastructure

**Files:**
- Create: `docker-compose.yml`
- Create: `apps/api/src/db/client.ts`
- Create: `apps/api/src/db/test-utils.ts`
- Modify: `apps/api/package.json` (add dependencies)
- Modify: `package.json` (add scripts)
- Modify: `.env.example`

- [ ] **Step 1: Add dependencies to `apps/api/package.json`**

```json
{
  "dependencies": {
    "@zipship/config": "workspace:*",
    "@zipship/db": "workspace:*",
    "@zipship/shared": "workspace:*",
    "drizzle-orm": "catalog:",
    "elysia": "catalog:",
    "pg": "^8.13.0"
  },
  "devDependencies": {
    "@types/pg": "^8.11.0",
    "typescript": "catalog:"
  }
}
```

Run: `cd g:/zipship && bun install`
Expected: Successful install with no warnings.

- [ ] **Step 2: Create `docker-compose.yml` at repo root**

```yaml
services:
  postgres:
    image: postgres:17-alpine
    ports:
      - "5432:5432"
    environment:
      POSTGRES_USER: zipship
      POSTGRES_PASSWORD: zipship
      POSTGRES_DB: zipship
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U zipship"]
      interval: 2s
      timeout: 2s
      retries: 10
    volumes:
      - pgdata:/var/lib/postgresql/data

volumes:
  pgdata:
```

- [ ] **Step 3: Create `apps/api/src/db/client.ts`**

```ts
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "@zipship/db";
import { config } from "@zipship/config";

let pool: Pool | null = null;

export function getDb() {
  if (!pool) {
    pool = new Pool({ connectionString: config.databaseUrl });
  }
  return drizzle(pool, { schema });
}

export function createTestDbClient(connectionString: string) {
  const testPool = new Pool({ connectionString });
  return drizzle(testPool, { schema });
}
```

- [ ] **Step 4: Create `apps/api/src/db/test-utils.ts`**

```ts
import { sql } from "drizzle-orm";
import * as schema from "@zipship/db";

export function createTestDb() {
  const { createTestDbClient } = require("./client");
  return createTestDbClient(
    process.env.TEST_DATABASE_URL ?? "postgres://zipship:zipship@localhost:5432/zipship"
  );
}

export async function truncateAllTables(db: ReturnType<typeof import("./client").createTestDbClient>) {
  const entries = Object.values(schema).filter(
    (v): v is { dbName: string } => typeof v === "function" && "dbName" in v,
  );
  for (const entry of entries) {
    await db.execute(sql`TRUNCATE TABLE ${sql.identifier(entry.dbName)} CASCADE`);
  }
}
```

- [ ] **Step 5: Add scripts to root `package.json`**

```json
{
  "scripts": {
    "db:up": "docker compose up -d",
    "db:down": "docker compose down",
    "db:migrate": "drizzle-kit migrate --config packages/db/drizzle.config.ts",
    "pretest": "bun run db:up && bun run db:migrate"
  }
}
```

(Add `db:up` and `db:down` alongside existing scripts; `pretest` is new. Update the existing `db:migrate` entry to keep consistent.)

- [ ] **Step 6: Verify infrastructure**

```bash
cd g:/zipship && docker compose up -d && bun run db:migrate
```
Expected: PostgreSQL container starts, migrations apply successfully.

- [ ] **Step 7: Commit**

```bash
git add docker-compose.yml apps/api/src/db/ apps/api/package.json package.json .env.example
git commit -m "feat: add PostgreSQL infrastructure (docker-compose, Drizzle client, test utils)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: Auth + Audit + Organizations Drizzle Repositories

These three modules have interfaces that are already mostly self-contained (auth operations, audit logs, org/member queries). Each new file implements the module's existing interface as a factory function.

**Files:**
- Create: `apps/api/src/modules/auth/drizzle-repository.ts` → `AuthRepository`
- Create: `apps/api/src/modules/audit/drizzle-repository.ts` → `AuditRepository`
- Create: `apps/api/src/modules/organizations/drizzle-repository.ts` → `OrganizationsRepository`

**Interfaces (from `service.ts`, unchanged):**

`AuthRepository`: `emailExists`, `findUserByEmail`, `createUserWithDefaultOrganization`, `createSession`, `findSessionByRefreshTokenHash`, `findDefaultOrganizationForUser`

`AuditRepository`: `createAuditLog`

`OrganizationsRepository`: `listOrganizationsForUser`, `findMembership`

- [ ] **Step 1: Create auth/drizzle-repository.ts**

```ts
import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@zipship/db";
import type { AuthRepository } from "./service";

export function createDrizzleAuthRepository(
  db: NodePgDatabase<typeof schema>
): AuthRepository {
  return {
    async emailExists(email) {
      const rows = await db.select({ id: schema.users.id })
        .from(schema.users)
        .where(eq(schema.users.email, email))
        .limit(1);
      return rows.length > 0;
    },

    async findUserByEmail(email) {
      const rows = await db.select()
        .from(schema.users)
        .where(eq(schema.users.email, email))
        .limit(1);
      return rows[0] ?? null;
    },

    async createUserWithDefaultOrganization(input) {
      return await db.transaction(async (tx) => {
        const [user] = await tx.insert(schema.users).values({
          name: input.user.name,
          email: input.user.email,
          passwordHash: input.user.passwordHash,
        }).returning({ id: schema.users.id, name: schema.users.name, email: schema.users.email });

        const [org] = await tx.insert(schema.organizations).values({
          name: input.organization.name,
          slug: input.organization.slug,
          ownerId: user.id,
        }).returning({ id: schema.organizations.id, name: schema.organizations.name, slug: schema.organizations.slug });

        const [member] = await tx.insert(schema.members).values({
          organizationId: org.id,
          userId: user.id,
          role: input.member.role,
          status: "active",
        }).returning({ id: schema.members.id, role: schema.members.role });

        return { user, organization: org, member };
      });
    },

    async createSession(input) {
      const [session] = await db.insert(schema.sessions).values({
        userId: input.userId,
        clientType: input.clientType,
        refreshTokenHash: input.refreshTokenHash,
        expiresAt: input.expiresAt,
      }).returning({ id: schema.sessions.id, clientType: schema.sessions.clientType, expiresAt: schema.sessions.expiresAt });

      return { id: session.id, clientType: session.clientType, expiresAt: session.expiresAt.toISOString() };
    },

    async findSessionByRefreshTokenHash(refreshTokenHash, now) {
      const rows = await db.select({
        session: { id: schema.sessions.id, clientType: schema.sessions.clientType, expiresAt: schema.sessions.expiresAt },
        user: { id: schema.users.id, name: schema.users.name, email: schema.users.email },
      })
        .from(schema.sessions)
        .innerJoin(schema.users, eq(schema.sessions.userId, schema.users.id))
        .where(eq(schema.sessions.refreshTokenHash, refreshTokenHash))
        .limit(1);

      if (!rows[0] || rows[0].session.expiresAt <= now) return null;
      return { user: rows[0].user, session: { ...rows[0].session, expiresAt: rows[0].session.expiresAt.toISOString() } };
    },

    async findDefaultOrganizationForUser(userId) {
      const rows = await db.select({ id: schema.members.organizationId })
        .from(schema.members)
        .where(eq(schema.members.userId, userId))
        .limit(1);
      return rows[0] ? { id: rows[0].organizationId } : null;
    },
  };
}
```

- [ ] **Step 2: Create audit/drizzle-repository.ts**

```ts
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@zipship/db";
import type { AuditRepository } from "./service";

export function createDrizzleAuditRepository(
  db: NodePgDatabase<typeof schema>
): AuditRepository {
  return {
    async createAuditLog(input) {
      const [log] = await db.insert(schema.auditLogs).values({
        organizationId: input.organizationId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId,
        metadata: input.metadata,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      }).returning();

      return {
        id: log.id,
        organizationId: log.organizationId,
        projectId: log.projectId,
        actorId: log.actorId,
        action: log.action,
        targetType: log.targetType,
        targetId: log.targetId,
        metadata: log.metadata as Record<string, unknown>,
        ipAddress: log.ipAddress,
        userAgent: log.userAgent,
        createdAt: log.createdAt.toISOString(),
      };
    },

    // Test utility: list all audit logs
    async listAuditLogsForTest() {
      const logs = await db.select().from(schema.auditLogs)
        .orderBy(schema.auditLogs.createdAt);
      return logs.map(log => ({
        id: log.id,
        organizationId: log.organizationId,
        projectId: log.projectId,
        actorId: log.actorId,
        action: log.action,
        targetType: log.targetType,
        targetId: log.targetId,
        metadata: log.metadata as Record<string, unknown>,
        ipAddress: log.ipAddress,
        userAgent: log.userAgent,
        createdAt: log.createdAt.toISOString(),
      }));
    },
  };
}
```

Note: `listAuditLogsForTest` is added to the interface as a test control. The spec places these on the respective drizzle repos.

- [ ] **Step 3: Create organizations/drizzle-repository.ts**

```ts
import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@zipship/db";
import type { OrganizationsRepository } from "./service";

export function createDrizzleOrganizationsRepository(
  db: NodePgDatabase<typeof schema>
): OrganizationsRepository {
  return {
    async listOrganizationsForUser(userId) {
      const rows = await db.select({
        id: schema.organizations.id,
        name: schema.organizations.name,
        slug: schema.organizations.slug,
        role: schema.members.role,
      })
        .from(schema.members)
        .innerJoin(schema.organizations, eq(schema.members.organizationId, schema.organizations.id))
        .where(eq(schema.members.userId, userId));

      return rows;
    },

    async findMembership(input) {
      const rows = await db.select({ role: schema.members.role })
        .from(schema.members)
        .where(eq(schema.members.organizationId, input.organizationId))
        .limit(1);
      return rows[0] ?? null;
    },

    // Test utility
    async setMemberRoleForTest(input) {
      await db.update(schema.members)
        .set({ role: input.role })
        .where(eq(schema.members.organizationId, input.organizationId));
    },
  };
}
```

- [ ] **Step 4: Run typecheck**

```bash
cd g:/zipship && bun run typecheck
```
Expected: All packages pass typecheck.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/auth/drizzle-repository.ts apps/api/src/modules/audit/drizzle-repository.ts apps/api/src/modules/organizations/drizzle-repository.ts
git commit -m "feat: add auth, audit, organizations Drizzle repositories

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: Projects + Releases Drizzle Repositories

**Files:**
- Create: `apps/api/src/modules/projects/drizzle-repository.ts` → `ProjectsRepository`
- Create: `apps/api/src/modules/releases/drizzle-repository.ts` → `ReleasesRepository`

`ProjectsRepository` interface includes: `findSessionByRefreshTokenHash`, `findMembership`, `projectSlugExists`, `createProject`, `listProjectsForOrganization`, `findProjectById`

`ReleasesRepository` interface includes: `findSessionByRefreshTokenHash`, `findProjectById`, `findMembership`, `listReleasesForProject`, `findReleaseById`, `findPreviewableReleaseByProjectIdAndHash`

- [ ] **Step 1: Create projects/drizzle-repository.ts**

```ts
import { eq, and } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@zipship/db";
import type { ProjectsRepository } from "./service";

export function createDrizzleProjectsRepository(
  db: NodePgDatabase<typeof schema>
): ProjectsRepository {
  return {
    async findSessionByRefreshTokenHash(refreshTokenHash, now) {
      const rows = await db.select({
        session: { id: schema.sessions.id, clientType: schema.sessions.clientType, expiresAt: schema.sessions.expiresAt },
        user: { id: schema.users.id, name: schema.users.name, email: schema.users.email },
      })
        .from(schema.sessions)
        .innerJoin(schema.users, eq(schema.sessions.userId, schema.users.id))
        .where(eq(schema.sessions.refreshTokenHash, refreshTokenHash))
        .limit(1);

      if (!rows[0] || rows[0].session.expiresAt <= now) return null;
      return { user: rows[0].user, session: { ...rows[0].session, expiresAt: rows[0].session.expiresAt.toISOString() } };
    },

    async findMembership(input) {
      const rows = await db.select({ role: schema.members.role })
        .from(schema.members)
        .where(and(
          eq(schema.members.organizationId, input.organizationId),
          eq(schema.members.userId, input.userId),
        ))
        .limit(1);
      return rows[0] ?? null;
    },

    async projectSlugExists(input) {
      const rows = await db.select({ id: schema.projects.id })
        .from(schema.projects)
        .where(eq(schema.projects.slug, input.slug))
        .limit(1);
      return rows.length > 0;
    },

    async createProject(input) {
      const [project] = await db.insert(schema.projects).values({
        organizationId: input.organizationId,
        name: input.name,
        slug: input.slug,
        description: input.description,
        createdBy: input.createdBy,
      }).returning();

      return {
        id: project.id,
        organizationId: project.organizationId,
        name: project.name,
        slug: project.slug,
        description: project.description,
        currentReleaseId: project.currentReleaseId,
        status: project.status,
        visibility: project.visibility,
        createdBy: project.createdBy,
        createdAt: project.createdAt.toISOString(),
        updatedAt: project.updatedAt.toISOString(),
      };
    },

    async listProjectsForOrganization(organizationId) {
      const rows = await db.select()
        .from(schema.projects)
        .where(eq(schema.projects.organizationId, organizationId));

      return rows.map(toProject);
    },

    async findProjectById(projectId) {
      const rows = await db.select()
        .from(schema.projects)
        .where(eq(schema.projects.id, projectId))
        .limit(1);

      return rows[0] ? toProject(rows[0]) : null;
    },
  };
}

function toProject(record: typeof schema.projects.$inferSelect) {
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

- [ ] **Step 2: Create releases/drizzle-repository.ts**

```ts
import { eq, and, or, inArray } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@zipship/db";
import type { ReleasesRepository } from "./service";

export function createDrizzleReleasesRepository(
  db: NodePgDatabase<typeof schema>
): ReleasesRepository {
  return {
    async findSessionByRefreshTokenHash(refreshTokenHash, now) {
      const rows = await db.select({
        session: { id: schema.sessions.id, clientType: schema.sessions.clientType, expiresAt: schema.sessions.expiresAt },
        user: { id: schema.users.id, name: schema.users.name, email: schema.users.email },
      })
        .from(schema.sessions)
        .innerJoin(schema.users, eq(schema.sessions.userId, schema.users.id))
        .where(eq(schema.sessions.refreshTokenHash, refreshTokenHash))
        .limit(1);

      if (!rows[0] || rows[0].session.expiresAt <= now) return null;
      return { user: rows[0].user, session: { ...rows[0].session, expiresAt: rows[0].session.expiresAt.toISOString() } };
    },

    async findProjectById(projectId) {
      const rows = await db.select()
        .from(schema.projects)
        .where(eq(schema.projects.id, projectId))
        .limit(1);
      return rows[0] ?? null;
    },

    async findMembership(input) {
      const rows = await db.select({ role: schema.members.role })
        .from(schema.members)
        .where(and(
          eq(schema.members.organizationId, input.organizationId),
          eq(schema.members.userId, input.userId),
        ))
        .limit(1);
      return rows[0] ?? null;
    },

    async listReleasesForProject(projectId) {
      const rows = await db.select()
        .from(schema.releases)
        .where(eq(schema.releases.projectId, projectId))
        .orderBy(schema.releases.versionNumber);

      return rows.map(toRelease).reverse(); // newest first
    },

    async findReleaseById(releaseId) {
      const rows = await db.select()
        .from(schema.releases)
        .where(eq(schema.releases.id, releaseId))
        .limit(1);
      return rows[0] ? toRelease(rows[0]) : null;
    },

    async findPreviewableReleaseByProjectIdAndHash(input) {
      const rows = await db.select()
        .from(schema.releases)
        .where(and(
          eq(schema.releases.projectId, input.projectId),
          eq(schema.releases.releaseHash, input.releaseHash),
          or(eq(schema.releases.status, "ready"), eq(schema.releases.status, "active")),
        ))
        .limit(1);

      const release = rows[0];
      if (!release) return null;
      return toRelease(release);
    },

    // Test utility
    async setReleaseStateForTest(input) {
      await db.update(schema.releases)
        .set({
          status: input.status,
          archivedAt: input.archived ? new Date() : null,
        })
        .where(eq(schema.releases.id, input.releaseId));
    },
  };
}

function toRelease(record: typeof schema.releases.$inferSelect) {
  return {
    id: record.id,
    projectId: record.projectId,
    versionNumber: record.versionNumber,
    releaseHash: record.releaseHash,
    previewUrl: null,
    fullHash: record.fullHash,
    status: record.status,
    storagePath: record.storagePath,
    rawUploadPath: record.rawUploadPath,
    fileCount: record.fileCount,
    totalSize: record.totalSize,
    manifest: record.manifest as Record<string, unknown>,
    detectResult: record.detectResult as Record<string, unknown>,
    createdBy: record.createdBy,
    createdAt: record.createdAt.toISOString(),
    activatedAt: record.activatedAt?.toISOString() ?? null,
    archivedAt: record.archivedAt?.toISOString() ?? null,
  };
}
```

- [ ] **Step 3: Typecheck**

```bash
cd g:/zipship && bun run typecheck
```

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/projects/drizzle-repository.ts apps/api/src/modules/releases/drizzle-repository.ts
git commit -m "feat: add projects and releases Drizzle repositories

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 4: Upload Pipeline Drizzle Repositories

**Files:**
- Create: `apps/api/src/modules/uploads/drizzle-repository.ts` → `UploadsRepository`
- Create: `apps/api/src/modules/site-preview/drizzle-repository.ts` → `SitePreviewRepository`
- Create: `apps/api/src/modules/release-processing/drizzle-repository.ts` → `ReleaseProcessingRepository`

- [ ] **Step 1: Create uploads/drizzle-repository.ts**

```ts
import { eq, and } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@zipship/db";
import type { UploadsRepository } from "./service";

export function createDrizzleUploadsRepository(
  db: NodePgDatabase<typeof schema>
): UploadsRepository {
  return {
    async findSessionByRefreshTokenHash(refreshTokenHash, now) {
      const rows = await db.select({
        session: { id: schema.sessions.id, clientType: schema.sessions.clientType, expiresAt: schema.sessions.expiresAt },
        user: { id: schema.users.id, name: schema.users.name, email: schema.users.email },
      })
        .from(schema.sessions)
        .innerJoin(schema.users, eq(schema.sessions.userId, schema.users.id))
        .where(eq(schema.sessions.refreshTokenHash, refreshTokenHash))
        .limit(1);

      if (!rows[0] || rows[0].session.expiresAt <= now) return null;
      return { user: rows[0].user, session: { ...rows[0].session, expiresAt: rows[0].session.expiresAt.toISOString() } };
    },

    async findProjectById(projectId) {
      const rows = await db.select()
        .from(schema.projects)
        .where(eq(schema.projects.id, projectId))
        .limit(1);
      return rows[0] ?? null;
    },

    async findMembership(input) {
      const rows = await db.select({ role: schema.members.role })
        .from(schema.members)
        .where(and(
          eq(schema.members.organizationId, input.organizationId),
          eq(schema.members.userId, input.userId),
        ))
        .limit(1);
      return rows[0] ?? null;
    },

    async createUploadTask(input) {
      const [task] = await db.insert(schema.uploadTasks).values({
        projectId: input.projectId,
        status: "pending",
        rawUploadPath: `uploads/raw/${input.projectId}/placeholder/${input.originalFilename}`,
        originalFilename: input.originalFilename,
        size: input.size,
        createdBy: input.createdBy,
      }).returning();
      return toUploadTask(task);
    },

    async findUploadTaskById(uploadTaskId) {
      const rows = await db.select()
        .from(schema.uploadTasks)
        .where(eq(schema.uploadTasks.id, uploadTaskId))
        .limit(1);
      return rows[0] ? toUploadTask(rows[0]) : null;
    },

    async markUploadTaskProcessing(input) {
      const [task] = await db.update(schema.uploadTasks)
        .set({ status: "processing", startedAt: input.now })
        .where(eq(schema.uploadTasks.id, input.uploadTaskId))
        .returning();
      return toUploadTask(task);
    },

    async markUploadTaskUploaded(input) {
      const [task] = await db.update(schema.uploadTasks)
        .set({ status: "uploading", rawUploadPath: input.rawUploadPath, size: input.size })
        .where(eq(schema.uploadTasks.id, input.uploadTaskId))
        .returning();
      return toUploadTask(task);
    },

    async completeProcessedRelease(input) {
      const [release] = await db.update(schema.releases)
        .set({
          status: "ready",
          releaseHash: input.releaseHash,
          fullHash: input.fullHash,
          storagePath: input.storagePath,
          fileCount: input.fileCount,
          totalSize: input.totalSize,
          manifest: input.manifest,
          detectResult: input.detectResult,
        })
        .where(eq(schema.releases.id, input.releaseId))
        .returning();

      const [task] = await db.update(schema.uploadTasks)
        .set({ status: "completed", errorMessage: null, finishedAt: input.finishedAt })
        .where(eq(schema.uploadTasks.id, input.uploadTaskId))
        .returning();
      return toUploadTask(task);
    },

    async failProcessedRelease(input) {
      await db.update(schema.releases)
        .set({ status: "failed", detectResult: input.detectResult })
        .where(eq(schema.releases.id, input.releaseId));

      const [task] = await db.update(schema.uploadTasks)
        .set({ status: "failed", errorMessage: input.errorCode, finishedAt: input.finishedAt })
        .where(eq(schema.uploadTasks.id, input.uploadTaskId))
        .returning();
      return toUploadTask(task);
    },
  };
}

function toUploadTask(record: typeof schema.uploadTasks.$inferSelect) {
  return {
    id: record.id,
    projectId: record.projectId,
    releaseId: record.releaseId,
    status: record.status,
    rawUploadPath: record.rawUploadPath,
    originalFilename: record.originalFilename,
    size: record.size,
    errorMessage: record.errorMessage,
    createdBy: record.createdBy,
    createdAt: record.createdAt.toISOString(),
    startedAt: record.startedAt?.toISOString() ?? null,
    finishedAt: record.finishedAt?.toISOString() ?? null,
  };
}
```

- [ ] **Step 2: Create site-preview/drizzle-repository.ts**

```ts
import { eq, or } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@zipship/db";
import type { SitePreviewRepository } from "./service";

export function createDrizzleSitePreviewRepository(
  db: NodePgDatabase<typeof schema>
): SitePreviewRepository {
  return {
    async findProjectBySlug(slug) {
      const rows = await db.select()
        .from(schema.projects)
        .where(eq(schema.projects.slug, slug))
        .limit(1);
      return rows[0] ?? null;
    },

    async findPreviewableReleaseByProjectIdAndHash(input) {
      const rows = await db.select()
        .from(schema.releases)
        .where(and(
          eq(schema.releases.projectId, input.projectId),
          eq(schema.releases.releaseHash, input.releaseHash),
        ))
        .limit(1);

      const release = rows[0];
      if (!release) return null;

      return {
        id: release.id,
        projectId: release.projectId,
        versionNumber: release.versionNumber,
        releaseHash: release.releaseHash,
        previewUrl: null,
        fullHash: release.fullHash,
        status: release.status,
        storagePath: release.storagePath,
        rawUploadPath: release.rawUploadPath,
        fileCount: release.fileCount,
        totalSize: release.totalSize,
        manifest: release.manifest as Record<string, unknown>,
        detectResult: release.detectResult as Record<string, unknown>,
        createdBy: release.createdBy,
        createdAt: release.createdAt.toISOString(),
        activatedAt: release.activatedAt?.toISOString() ?? null,
        archivedAt: release.archivedAt?.toISOString() ?? null,
      };
    },
  };
}
```

- [ ] **Step 3: Create release-processing/drizzle-repository.ts**

```ts
import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@zipship/db";
import type { ReleaseProcessingRepository } from "./service";

export function createDrizzleReleaseProcessingRepository(
  db: NodePgDatabase<typeof schema>
): ReleaseProcessingRepository {
  return {
    async findProjectById(projectId) {
      const rows = await db.select()
        .from(schema.projects)
        .where(eq(schema.projects.id, projectId))
        .limit(1);
      return rows[0] ?? null;
    },

    async findUploadTaskById(uploadTaskId) {
      const rows = await db.select()
        .from(schema.uploadTasks)
        .where(eq(schema.uploadTasks.id, uploadTaskId))
        .limit(1);
      return rows[0] ?? null;
    },

    async completeProcessedRelease(input) {
      const [release] = await db.update(schema.releases)
        .set({
          status: "ready",
          releaseHash: input.releaseHash,
          fullHash: input.fullHash,
          storagePath: input.storagePath,
          fileCount: input.fileCount,
          totalSize: input.totalSize,
          manifest: input.manifest,
          detectResult: input.detectResult,
        })
        .where(eq(schema.releases.id, input.releaseId))
        .returning();

      const [task] = await db.update(schema.uploadTasks)
        .set({ status: "completed", errorMessage: null, finishedAt: input.finishedAt })
        .where(eq(schema.uploadTasks.id, input.uploadTaskId))
        .returning();
      return toUploadTask(task);
    },

    async failProcessedRelease(input) {
      await db.update(schema.releases)
        .set({ status: "failed", detectResult: input.detectResult })
        .where(eq(schema.releases.id, input.releaseId));

      const [task] = await db.update(schema.uploadTasks)
        .set({ status: "failed", errorMessage: input.errorCode, finishedAt: input.finishedAt })
        .where(eq(schema.uploadTasks.id, input.uploadTaskId))
        .returning();
      return toUploadTask(task);
    },
  };
}

function toUploadTask(record: typeof schema.uploadTasks.$inferSelect) {
  return {
    id: record.id,
    projectId: record.projectId,
    releaseId: record.releaseId,
    status: record.status,
    rawUploadPath: record.rawUploadPath,
    originalFilename: record.originalFilename,
    size: record.size,
    errorMessage: record.errorMessage,
    createdBy: record.createdBy,
    createdAt: record.createdAt.toISOString(),
    startedAt: record.startedAt?.toISOString() ?? null,
    finishedAt: record.finishedAt?.toISOString() ?? null,
  };
}
```

- [ ] **Step 4: Typecheck**

```bash
cd g:/zipship && bun run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/uploads/drizzle-repository.ts apps/api/src/modules/site-preview/drizzle-repository.ts apps/api/src/modules/release-processing/drizzle-repository.ts
git commit -m "feat: add uploads, site-preview, release-processing Drizzle repositories

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 5: Deployments Drizzle Repository

**Files:**
- Create: `apps/api/src/modules/deployments/drizzle-repository.ts` → `DeploymentsRepository`

`DeploymentsRepository` extends `AuditRepository` and includes: `findSessionByRefreshTokenHash`, `findProjectById`, `findMembership`, `findReleaseById`, `listDeploymentsForProject`, `publishRelease`, `rollbackRelease`, `createAuditLog` (from AuditRepository).

This is the most complex repository because `publishRelease` and `rollbackRelease` involve atomic updates across `projects`, `releases`, and `deployments` tables.

- [ ] **Step 1: Create deployments/drizzle-repository.ts**

```ts
import { eq, and } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@zipship/db";
import type { DeploymentsRepository } from "./service";

export function createDrizzleDeploymentsRepository(
  db: NodePgDatabase<typeof schema>
): DeploymentsRepository {
  return {
    async findSessionByRefreshTokenHash(refreshTokenHash, now) {
      const rows = await db.select({
        session: { id: schema.sessions.id, clientType: schema.sessions.clientType, expiresAt: schema.sessions.expiresAt },
        user: { id: schema.users.id, name: schema.users.name, email: schema.users.email },
      })
        .from(schema.sessions)
        .innerJoin(schema.users, eq(schema.sessions.userId, schema.users.id))
        .where(eq(schema.sessions.refreshTokenHash, refreshTokenHash))
        .limit(1);

      if (!rows[0] || rows[0].session.expiresAt <= now) return null;
      return { user: rows[0].user, session: { ...rows[0].session, expiresAt: rows[0].session.expiresAt.toISOString() } };
    },

    async findProjectById(projectId) {
      const rows = await db.select()
        .from(schema.projects)
        .where(eq(schema.projects.id, projectId))
        .limit(1);
      return rows[0] ?? null;
    },

    async findMembership(input) {
      const rows = await db.select({ role: schema.members.role })
        .from(schema.members)
        .where(and(
          eq(schema.members.organizationId, input.organizationId),
          eq(schema.members.userId, input.userId),
        ))
        .limit(1);
      return rows[0] ?? null;
    },

    async findReleaseById(releaseId) {
      const rows = await db.select()
        .from(schema.releases)
        .where(eq(schema.releases.id, releaseId))
        .limit(1);
      return rows[0] ?? null;
    },

    async listDeploymentsForProject(projectId) {
      const rows = await db.select()
        .from(schema.deployments)
        .where(eq(schema.deployments.projectId, projectId))
        .orderBy(schema.deployments.createdAt);
      return rows.reverse().map(toDeployment);
    },

    async publishRelease(input) {
      return await mutateCurrentRelease(db, { ...input, action: "publish" });
    },

    async rollbackRelease(input) {
      return await mutateCurrentRelease(db, { ...input, action: "rollback" });
    },

    async createAuditLog(input) {
      const [log] = await db.insert(schema.auditLogs).values({
        organizationId: input.organizationId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId,
        metadata: input.metadata,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      }).returning();

      return {
        id: log.id,
        organizationId: log.organizationId,
        projectId: log.projectId,
        actorId: log.actorId,
        action: log.action,
        targetType: log.targetType,
        targetId: log.targetId,
        metadata: log.metadata as Record<string, unknown>,
        ipAddress: log.ipAddress,
        userAgent: log.userAgent,
        createdAt: log.createdAt.toISOString(),
      };
    },
  };
}

async function mutateCurrentRelease(
  db: NodePgDatabase<typeof schema>,
  input: {
    projectId: string;
    releaseId: string;
    operatorId: string;
    message: string | null;
    action: "publish" | "rollback";
    now: Date;
  },
) {
  return await db.transaction(async (tx) => {
    const [project] = await tx.select().from(schema.projects)
      .where(eq(schema.projects.id, input.projectId))
      .limit(1);
    if (!project) throw new Error("Project not found");

    const [release] = await tx.select().from(schema.releases)
      .where(eq(schema.releases.id, input.releaseId))
      .limit(1);
    if (!release) throw new Error("Release not found");

    const previousReleaseId = project.currentReleaseId;

    // Fetch previous release data (before mutation) for return value
    let previousReleaseData = null;
    if (previousReleaseId && previousReleaseId !== input.releaseId) {
      const [prev] = await tx.select().from(schema.releases)
        .where(eq(schema.releases.id, previousReleaseId))
        .limit(1);
      if (prev) {
        // Mark previous active release back to ready
        await tx.update(schema.releases)
          .set({ status: "ready" })
          .where(eq(schema.releases.id, previousReleaseId));

        previousReleaseData = prev;
      }
    }

    // Mark new release as active
    await tx.update(schema.releases)
      .set({ status: "active", activatedAt: input.now })
      .where(eq(schema.releases.id, input.releaseId));

    // Update project's current release
    await tx.update(schema.projects)
      .set({ currentReleaseId: input.releaseId, updatedAt: input.now })
      .where(eq(schema.projects.id, input.projectId));

    // Create deployment record
    const [deployment] = await tx.insert(schema.deployments).values({
      projectId: project.id,
      releaseId: release.id,
      previousReleaseId,
      action: input.action,
      status: "success",
      operatorId: input.operatorId,
      message: input.message,
    }).returning();

    return {
      deployment: toDeployment(deployment),
      project: {
        id: project.id,
        organizationId: project.organizationId,
        name: project.name,
        slug: project.slug,
        description: project.description,
        currentReleaseId: input.releaseId,
        status: project.status,
        visibility: project.visibility,
        createdBy: project.createdBy,
        createdAt: project.createdAt.toISOString(),
        updatedAt: input.now.toISOString(),
      },
      release: {
        id: release.id,
        projectId: release.projectId,
        versionNumber: release.versionNumber,
        releaseHash: release.releaseHash,
        previewUrl: `/_sites/${project.slug}/${release.releaseHash}/`,
        fullHash: release.fullHash,
        status: "active",
        storagePath: release.storagePath,
        rawUploadPath: release.rawUploadPath,
        fileCount: release.fileCount,
        totalSize: release.totalSize,
        manifest: release.manifest as Record<string, unknown>,
        detectResult: release.detectResult as Record<string, unknown>,
        createdBy: release.createdBy,
        createdAt: release.createdAt.toISOString(),
        activatedAt: input.now.toISOString(),
        archivedAt: null,
      },
      previousRelease: previousReleaseData
        ? {
            id: previousReleaseData.id,
            projectId: previousReleaseData.projectId,
            versionNumber: previousReleaseData.versionNumber,
            releaseHash: previousReleaseData.releaseHash,
            previewUrl: `/_sites/${project.slug}/${previousReleaseData.releaseHash}/`,
            fullHash: previousReleaseData.fullHash,
            status: "ready",
            storagePath: previousReleaseData.storagePath,
            rawUploadPath: previousReleaseData.rawUploadPath,
            fileCount: previousReleaseData.fileCount,
            totalSize: previousReleaseData.totalSize,
            manifest: previousReleaseData.manifest as Record<string, unknown>,
            detectResult: previousReleaseData.detectResult as Record<string, unknown>,
            createdBy: previousReleaseData.createdBy,
            createdAt: previousReleaseData.createdAt.toISOString(),
            activatedAt: previousReleaseData.activatedAt?.toISOString() ?? null,
            archivedAt: previousReleaseData.archivedAt?.toISOString() ?? null,
          }
        : null,
    };
  });
}

function toDeployment(record: typeof schema.deployments.$inferSelect) {
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

- [ ] **Step 2: Typecheck**

```bash
cd g:/zipship && bun run typecheck
```

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/modules/deployments/drizzle-repository.ts
git commit -m "feat: add deployments Drizzle repository with atomic publish/rollback

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 6: Slim Repository Interfaces + Refactor Services + Plugins + createApp()

This task modifies the service interfaces, service constructors, module plugins, and the main `createApp()` function to use per-module specific repositories instead of the combined in-memory repo.

**Pattern for each module:**
1. Remove cross-module methods from the repository interface
2. Add specific repository parameters to the service options
3. Update service method calls from `options.repository.method()` to `options.xxxRepository.method()`
4. Update the plugin's `index.ts` to accept and pass specific repositories
5. Update `createApp()` in `src/index.ts` to wire everything

**Modules with slimmed interfaces:**
- `ProjectsRepository`: REMOVE `findSessionByRefreshTokenHash`, `findMembership`
- `ReleasesRepository`: REMOVE `findSessionByRefreshTokenHash`, `findProjectById`, `findMembership`
- `UploadsRepository`: REMOVE `findSessionByRefreshTokenHash`, `findProjectById`, `findMembership`
- `DeploymentsRepository`: REMOVE `findSessionByRefreshTokenHash`, `findProjectById`, `findMembership`, `findReleaseById`, `createAuditLog` (and stop extending `AuditRepository`)
- `ReleaseProcessingRepository`: REMOVE `findProjectById`, `findUploadTaskById`

**Modules that keep their interfaces** (already self-contained or minimal):
- `AuthRepository` — unchanged
- `AuditRepository` — unchanged (add `listAuditLogsForTest`)
- `OrganizationsRepository` — unchanged (add `setMemberRoleForTest`)
- `SitePreviewRepository` — unchanged

**Files:**
- Modify: `apps/api/src/modules/projects/service.ts`
- Modify: `apps/api/src/modules/projects/index.ts`
- Modify: `apps/api/src/modules/releases/service.ts`
- Modify: `apps/api/src/modules/releases/index.ts`
- Modify: `apps/api/src/modules/uploads/service.ts`
- Modify: `apps/api/src/modules/uploads/index.ts`
- Modify: `apps/api/src/modules/deployments/service.ts`
- Modify: `apps/api/src/modules/deployments/index.ts`
- Modify: `apps/api/src/modules/release-processing/service.ts`
- Modify: `apps/api/src/modules/site-preview/index.ts`
- Modify: `apps/api/src/modules/auth/index.ts`
- Modify: `apps/api/src/modules/organizations/index.ts`
- Modify: `apps/api/src/index.ts`

- [ ] **Step 1: Slim `ProjectsRepository` + refactor `ProjectsService`**

**In `service.ts`:**
- Remove `findSessionByRefreshTokenHash` and `findMembership` from `ProjectsRepository`
- Add `sessionRepository` and `membersRepository` to `ProjectsServiceOptions`

```ts
// Modified ProjectsServiceOptions in service.ts
export interface ProjectsServiceOptions {
  sessionRepository: Pick<AuthRepository, "findSessionByRefreshTokenHash">;
  membersRepository: Pick<OrganizationsRepository, "findMembership">;
  projectsRepository: ProjectsRepository;
  hashRefreshToken: (token: string) => Promise<string>;
  now: () => Date;
  permissions?: PermissionService;
}
```

Update `requireCurrentUser` in `ProjectsService`:
```ts
private async requireCurrentUser(headers: ProjectHeaders) {
  const refreshToken = parseBearerToken(headers.authorization);
  if (!refreshToken) return new ProjectUnauthorizedError();
  const currentSession = await this.options.sessionRepository.findSessionByRefreshTokenHash(
    await this.options.hashRefreshToken(refreshToken),
    this.options.now(),
  );
  if (!currentSession) return new ProjectUnauthorizedError();
  return currentSession;
}
```

Update `create` method:
```ts
const membership = await this.options.membersRepository.findMembership({
```

Update `list` method:
```ts
const membership = await this.options.membersRepository.findMembership({
```

Update `get` method:
```ts
const membership = await this.options.membersRepository.findMembership({
```

**In `index.ts`** — update `ProjectsModuleOptions`:
```ts
export interface ProjectsModuleOptions {
  sessionRepository: Pick<AuthRepository, "findSessionByRefreshTokenHash">;
  membersRepository: Pick<OrganizationsRepository, "findMembership">;
  projectsRepository: ProjectsRepository;
  hashRefreshToken: (token: string) => Promise<string>;
}
```

And in the service construction:
```ts
const projects = new ProjectsService({
  sessionRepository: options.sessionRepository,
  membersRepository: options.membersRepository,
  projectsRepository: options.projectsRepository,
  hashRefreshToken: options.hashRefreshToken,
  now: () => new Date(),
});
```

- [ ] **Step 2: Slim `ReleasesRepository` + refactor `ReleasesService`**

**In `service.ts`:**
- Remove `findSessionByRefreshTokenHash`, `findProjectById`, `findMembership` from `ReleasesRepository`
- Add `sessionRepository`, `projectsRepository`, `membersRepository` to `ReleasesServiceOptions`

**In `index.ts`:** Update plugin options to accept and pass:
```ts
sessionRepository, projectsRepository, membersRepository, releasesRepository, hashRefreshToken
```

- [ ] **Step 3: Slim `UploadsRepository` + refactor `UploadsService`**

**In `service.ts`:**
- Remove `findSessionByRefreshTokenHash`, `findProjectById`, `findMembership` from `UploadsRepository`
- Add `sessionRepository`, `projectsRepository`, `membersRepository` to `UploadsServiceOptions`
- Update all `options.repository.findProjectById(...)` → `options.projectsRepository.findProjectById(...)`
- Update all `options.repository.findMembership(...)` → `options.membersRepository.findMembership(...)`
- Update `requireCurrentUser`: `options.repository.findSessionByRefreshTokenHash` → `options.sessionRepository.findSessionByRefreshTokenHash`

**In `index.ts`:** Update plugin:
```ts
{
  uploadsRepository: UploadsRepository;
  projectsRepository: Pick<..., "findProjectById">;
  membersRepository: Pick<..., "findMembership">;
  sessionRepository: Pick<..., "findSessionByRefreshTokenHash">;
  releaseProcessingRepository: ReleaseProcessingRepository;
  hashRefreshToken: ...;
  storagePaths: ...;
}
```

- [ ] **Step 4: Slim `DeploymentsRepository` + refactor `DeploymentsService`**

**In `service.ts`:**
- Remove `findSessionByRefreshTokenHash`, `findProjectById`, `findMembership`, `findReleaseById` from `DeploymentsRepository`
- Stop extending `AuditRepository` on `DeploymentsRepository`
- Add `sessionRepository`, `projectsRepository`, `membersRepository`, `releasesRepository`, `auditRepository` to `DeploymentsServiceOptions`
- Update all repo method calls in the service body

**In `index.ts`:** Update plugin to accept and pass separate repos.

- [ ] **Step 5: Slim `ReleaseProcessingRepository` + refactor**

**In `service.ts`:**
- Remove `findProjectById`, `findUploadTaskById` from `ReleaseProcessingRepository`
- Add `projectsRepository`, `uploadsRepository` to `ReleaseProcessingServiceOptions`

- [ ] **Step 6: Update `createApp()` in `src/index.ts`**

Replace the in-memory repository with per-module Drizzle repositories:

```ts
import { getDb } from "./db/client";
import { createDrizzleAuthRepository } from "./modules/auth/drizzle-repository";
import { createDrizzleOrganizationsRepository } from "./modules/organizations/drizzle-repository";
// ... all other drizzle repo imports

export function createApp(options: CreateAppOptions = {}) {
  const db = options.db ?? getDb();
  const storagePaths = createStoragePaths(options.storageRoot ?? config.storageRoot);

  // Create per-module drizzle repos
  const authRepository = createDrizzleAuthRepository(db);
  const auditRepository = createDrizzleAuditRepository(db);
  const organizationsRepository = createDrizzleOrganizationsRepository(db);
  const projectsRepository = createDrizzleProjectsRepository(db);
  const releasesRepository = createDrizzleReleasesRepository(db);
  const uploadsRepository = createDrizzleUploadsRepository(db);
  const sitePreviewRepository = createDrizzleSitePreviewRepository(db);
  const deploymentsRepository = createDrizzleDeploymentsRepository(db);
  const releaseProcessingRepository = createDrizzleReleaseProcessingRepository(db);

  // Common repo slices for cross-module injection
  const sessionRepository = authRepository;  // only exposes findSessionByRefreshTokenHash
  const membersRepository = organizationsRepository;  // only exposes findMembership

  const api = new Elysia().get("/_health", () => ({ status: "ok", service: "zipship-api" }));

  // Test routes use specific repos directly
  if (options.exposeTestRoutes) {
    api
      .get("/_api/__test/auditLogs", async () => ({
        auditLogs: await auditRepository.listAuditLogsForTest(),
      }))
      .put("/_api/__test/memberRole", async ({ body }) => {
        await organizationsRepository.setMemberRoleForTest(body as any);
        return { ok: true };
      })
      .put("/_api/__test/releaseState", async ({ body }) => {
        await releasesRepository.setReleaseStateForTest(body as any);
        return { ok: true };
      });
  }

  return api
    .use(authModule({
      authRepository,
      auditRepository,
      hashRefreshToken,
    }))
    .use(organizationsModule({
      organizationsRepository,
      sessionRepository,
      hashRefreshToken,
    }))
    .use(projectsModule({
      projectsRepository,
      sessionRepository,
      membersRepository,
      hashRefreshToken,
    }))
    .use(projectDetailsModule({
      projectsRepository,
      sessionRepository,
      membersRepository,
      hashRefreshToken,
    }))
    .use(releasesModule({
      releasesRepository,
      sessionRepository,
      projectsRepository,
      membersRepository,
      hashRefreshToken,
    }))
    .use(deploymentsModule({
      deploymentsRepository,
      sessionRepository,
      projectsRepository,
      membersRepository,
      releasesRepository,
      auditRepository,
      hashRefreshToken,
      storage: deploymentStorage,
    }))
    .use(uploadsModule({
      uploadsRepository,
      sessionRepository,
      projectsRepository,
      membersRepository,
      releaseProcessingRepository,
      hashRefreshToken,
      storagePaths,
    }))
    .use(uploadDetailsModule({
      uploadsRepository,
      sessionRepository,
      projectsRepository,
      membersRepository,
      releaseProcessingRepository,
      hashRefreshToken,
      storagePaths,
    }))
    .use(sitePreviewModule({ sitePreviewRepository }));
}
```

**Interfaces for `CreateAppOptions`:**
```ts
export interface CreateAppOptions {
  storageRoot?: string;
  exposeTestRoutes?: boolean;
  db?: NodePgDatabase<typeof schema>;  // for test injection
}
```

**IMPORTANT:** Update `App` type export and add NodePgDatabase import.

- [ ] **Step 7: Typecheck**

```bash
cd g:/zipship && bun run typecheck
```
Expected: All 11 packages pass typecheck.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/
git commit -m "refactor: slim repository interfaces and wire per-module Drizzle repos

Each module now receives only the repositories it needs. In-memory
createInMemoryAuthRepository() is retained but no longer used in
createApp(). Module plugins accept specific repo types instead of a
single combined object.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 7: Update Tests for PostgreSQL

**Files (all 14 test files):**
- Modify: `tests/unit/auth-routes.test.ts`
- Modify: `tests/unit/auth-registration.test.ts`
- Modify: `tests/unit/auth-login.test.ts`
- Modify: `tests/unit/organizations-routes.test.ts`
- Modify: `tests/unit/projects-routes.test.ts`
- Modify: `tests/unit/releases-routes.test.ts`
- Modify: `tests/unit/uploads-routes.test.ts`
- Modify: `tests/unit/deployments-routes.test.ts`
- Modify: `tests/unit/site-preview-routes.test.ts`
- Modify: `tests/unit/storage-static.test.ts` (no DB needed — no changes)
- Modify: `tests/unit/permissions.test.ts` (pure logic — no changes)
- Modify: `tests/unit/project-slug.test.ts` (pure logic — no changes)
- Modify: `tests/nginx/nginx-routing.test.ts` (no changes)
- Modify: `packages/deploy-core/tests/` (no changes — deploy-core tests don't use API)

**Tests that need DB changes:** The 9 API route test files + 3 service-level test files.

Pattern for each test file:

```ts
import { createApp } from "../../apps/api/src";
import { createTestDbClient, truncateAllTables } from "../../apps/api/src/db/test-utils";

const db = createTestDbClient(
  process.env.TEST_DATABASE_URL ?? "postgres://zipship:zipship@localhost:5432/zipship"
);

beforeEach(async () => {
  await truncateAllTables(db);
});
```

And replace:
```ts
const api = treaty(createApp());
```
with:
```ts
const api = treaty(createApp({ db }));
```

And:
```ts
const app = createApp({ storageRoot, exposeTestRoutes: true });
```
with:
```ts
const app = createApp({ storageRoot, db, exposeTestRoutes: true });
```

- [ ] **Step 1: Add DB setup + teardown to auth-routes.test.ts**

Add beforeAll/beforeEach with truncation. Pass `{ db }` to createApp().

- [ ] **Step 2: Update auth-registration.test.ts**

Same pattern — needs DB but doesn't use createApp(). Add truncation before tests.

- [ ] **Step 3: Update auth-login.test.ts**

Same.

- [ ] **Step 4: Update organizations-routes.test.ts**

Add db + truncation + pass `{ db }`.

- [ ] **Step 5: Update projects-routes.test.ts**

Same.

- [ ] **Step 6: Update releases-routes.test.ts**

Same.

- [ ] **Step 7: Update uploads-routes.test.ts**

Same. This test creates temp storage directories — keep that pattern, add db on top.

- [ ] **Step 8: Update deployments-routes.test.ts**

Same. This test has the most complex setup.

- [ ] **Step 9: Update site-preview-routes.test.ts**

Same.

- [ ] **Step 10: Run tests**

```bash
cd g:/zipship
docker compose up -d
bun run db:migrate
bun test
```
Expected: All tests pass against PostgreSQL.

- [ ] **Step 11: Commit**

```bash
git add tests/
git commit -m "test: migrate tests to PostgreSQL with TRUNCATE isolation

All API route tests now connect to PostgreSQL via createApp({ db }).
Test isolation uses TRUNCATE TABLE ... CASCADE in beforeEach.
The in-memory repository is retained for future use but tests
exercise the real database.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 8: Cleanup — Remove Unused Test Route Dependencies

The test routes `setMemberRoleForTest`, `setReleaseStateForTest`, `listAuditLogsForTest` are now implemented on the specific drizzle repos. The test routes in `createApp()` already reference them directly (Task 6 Step 6). Verify the old test route code in `src/index.ts` that cast `repository as any` is cleaned up.

- [ ] **Step 1: Verify `src/index.ts` no longer references `createInMemoryAuthRepository` or its test methods**

```ts
// These should NOT appear in src/index.ts anymore:
// - import { createInMemoryAuthRepository }
// - repository.listAuditLogsForTest()
// - repository.setMemberRoleForTest()
// - repository.setReleaseStateForTest()
```

- [ ] **Step 2: Full test pass**

```bash
cd g:/zipship && bun test
```
Expected: 152 tests pass (with nginx skipped on Windows).

- [ ] **Step 3: Final commit**

```bash
git add .
git commit -m "chore: remove in-memory repo wiring from createApp()

Co-Authored-By: Claude <noreply@anthropic.com>"
```
