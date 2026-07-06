# PostgreSQL / Drizzle Repositories 设计文档

## 概述

将 ZipShip API 当前的内存存储替换为 PostgreSQL + Drizzle ORM 实现的持久化仓库。每个 API 模块获得独立的 Drizzle 仓库文件，实现其 `service.ts` 中定义的仓库接口。测试也用 PostgreSQL，通过 docker-compose 管理。

## 动机

- 当前所有 CRUD 数据存储在 `Map` 中，进程重启后丢失
- 数据库 Schema（10 张表、13 个枚举、外键、索引）已完整定义但未接入
- 内存仓库是 704 行单体函数同时实现 9 个接口，职责混杂

## 架构决策

### 决策 1：按模块拆分仓库（而非单体替换）

每个需要持久化的模块新增 `drizzle-repository.ts`，只实现自己的接口。避免延续单体仓库的反模式。

### 决策 2：用工厂函数而非 Class

`createXxxRepository(db)` 工厂函数风格与现有 `createInMemoryAuthRepository()` 一致，保持代码统一。

### 决策 3：测试也用 PostgreSQL

通过 `createApp({ db })` 注入测试数据库连接，实现真实数据库测试。测试之间通过 `TRUNCATE ... CASCADE` 隔离。

### 决策 4：保留内存仓库实现

`createInMemoryAuthRepository()` 保留不移除，用于快速原型和未来可能的测试场景。

## 文件结构

### 新增文件（12 个）

```
docker-compose.yml                          # PostgreSQL 17 容器
apps/api/src/db/
  client.ts                                 # DB 连接管理（生产/测试）
  test-utils.ts                             # truncate / seed 工具
apps/api/src/modules/
  auth/drizzle-repository.ts                → AuthRepository
  organizations/drizzle-repository.ts       → OrganizationsRepository
  projects/drizzle-repository.ts            → ProjectsRepository
  releases/drizzle-repository.ts            → ReleasesRepository
  uploads/drizzle-repository.ts             → UploadsRepository
  deployments/drizzle-repository.ts         → DeploymentsRepository
  site-preview/drizzle-repository.ts        → SitePreviewRepository
  audit/drizzle-repository.ts               → AuditRepository
  release-processing/drizzle-repository.ts  → ReleaseProcessingRepository
```

### 修改文件（约 18 个）

```
apps/api/src/index.ts                       # 替换 createInMemoryAuthRepository 为 Drizzle 版
apps/api/src/modules/*/index.ts             # 接收专用仓库参数（共 7 个路由模块）
tests/unit/*.test.ts                        # 注入 db 参数 + truncate 隔离
tests/nginx/nginx-routing.test.ts           # 依赖 data 层的测试也需调整
package.json                                # 新增 db:up/down 脚本 + pretest
```

## 数据库连接

### 生产环境

```ts
// apps/api/src/db/client.ts
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
```

### 测试环境

```ts
// 同文件
export function createTestDbClient(connectionString: string) {
  const testPool = new Pool({ connectionString });
  return drizzle(testPool, { schema });
}
```

## 仓库实现模式

每个 `drizzle-repository.ts` 遵循统一模式：

```ts
import { eq, and, inArray, sql, desc } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@zipship/db";
import type { XxxRepository } from "./service";

export function createDrizzleXxxRepository(
  db: NodePgDatabase<typeof schema>
): XxxRepository {
  return {
    async methodName(input) {
      // Drizzle 查询实现
    },
    // ...
  };
}
```

### 跨表事务

需要跨多表原子操作的场景使用 Drizzle 的 `db.transaction()`：

```ts
async createUserWithDefaultOrganization(input) {
  return await db.transaction(async (tx) => {
    const [user] = await tx.insert(schema.users).values({...}).returning();
    const [org] = await tx.insert(schema.organizations).values({...}).returning();
    const [member] = await tx.insert(schema.members).values({...}).returning();
    return { user, organization: org, member };
  });
}
```

涉及的模块：`auth`（注册时创建 user + org + member）、`deployments`（publish/rollback 更新多个表）。

### 测试控制方法

每个测试控制方法归属到对应的模块仓库：

```ts
// organizations/drizzle-repository.ts
async setMemberRoleForTest(input) {
  await db.update(schema.members)
    .set({ role: input.role })
    .where(and(
      eq(schema.members.organizationId, input.organizationId),
      eq(schema.members.userId, input.userId),
    ));
}

// releases/drizzle-repository.ts
async setReleaseStateForTest(input) {
  await db.update(schema.releases)
    .set({
      status: input.status,
      archivedAt: input.archived ? new Date() : null,
    })
    .where(eq(schema.releases.id, input.releaseId));
}

// audit/drizzle-repository.ts
async listAuditLogsForTest() {
  return await db.select().from(schema.auditLogs)
    .orderBy(schema.auditLogs.createdAt);
}
```

## 模块接口变更对照表

### 插件参数签名

| 模块 | 旧参数 | 新参数 |
|------|--------|--------|
| auth | `{ repository: AuthRepo & OrgRepo & AuditRepo, hashRefreshToken }` | `{ authRepository: AuthRepository, auditRepository: AuditRepository, hashRefreshToken }` |
| organizations | `{ repository, hashRefreshToken }` | `{ organizationsRepository: OrganizationsRepository, hashRefreshToken }` |
| projects | `{ repository, hashRefreshToken }` | `{ projectsRepository: ProjectsRepository, organizationsRepository: OrganizationsRepository, hashRefreshToken }` |
| releases | `{ repository, hashRefreshToken }` | `{ releasesRepository: ReleasesRepository, projectsRepository: ProjectsRepository, hashRefreshToken }` |
| deployments | `{ repository, hashRefreshToken, storage }` | `{ deploymentsRepository, projectsRepository, releasesRepository, auditRepository, hashRefreshToken, storage }` |
| uploads | `{ repository, hashRefreshToken, storagePaths }` | `{ uploadsRepository, projectsRepository, releaseProcessingRepository, hashRefreshToken, storagePaths }` |
| upload-details | `{ repository, hashRefreshToken, storagePaths }` | `{ uploadsRepository, projectsRepository, releaseProcessingRepository, hashRefreshToken, storagePaths }` |
| site-preview | `{ repository }` | `{ sitePreviewRepository: SitePreviewRepository }` |

### createApp() 新结构

`createApp()` 增加 `db` 参数支持：

```ts
export interface CreateAppOptions {
  storageRoot?: string;
  exposeTestRoutes?: boolean;
  db?: NodePgDatabase<typeof schema>;  // 新增：允许测试注入
}
```

内部创建所有仓库实例后按新签名传入各模块。测试路由直接引用具体仓库（不再通过统一 `repository` 对象）。

## Docker Compose

`docker-compose.yml` 放在项目根目录：

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

## 测试策略

### 数据隔离

每个测试文件在 `beforeEach` 中执行 TRUNCATE CASCADE，确保测试间隔离：

```ts
import { sql } from "drizzle-orm";
import * as schema from "@zipship/db";

async function truncateAllTables(db: ReturnType<typeof createTestDbClient>) {
  const entries = Object.values(schema).filter(
    (v): v is { dbName: string } => typeof v === "function" && "dbName" in v,
  );
  for (const entry of entries) {
    await db.execute(sql`TRUNCATE TABLE ${sql.identifier(entry.dbName)} CASCADE`);
  }
}
```

### 测试工厂函数

新增 `createTestDb()` 快捷方式：

```ts
export function createTestDb() {
  return createTestDbClient(
    process.env.TEST_DATABASE_URL ?? "postgres://zipship:zipship@localhost:5432/zipship"
  );
}
```

### 测试配置

根目录 `.env.example` 增加测试用 `TEST_DATABASE_URL` 变量或复用 `DATABASE_URL`。

### 执行流程

```bash
docker compose up -d         # 启动 PostgreSQL
bun run db:migrate           # 应用迁移，创建表结构
bun test                     # 执行测试（通过 createApp({ db }) 连接）
```

## 数据库依赖

新增 runtime 依赖：

- `drizzle-orm` — 已在根 `catalog` 中，`apps/api` 的 `package.json` 如果没配需要添加
- `pg` — node-postgres 驱动（需新增）
- `@types/pg` — dev 依赖

## 不移除

- `apps/api/src/modules/auth/repository.ts` — `createInMemoryAuthRepository()` 保留，用于其他场景
- 测试文件中的 `createApp()` 调用模式保持不变，仅增加 `{ db }` 参数

## 风险与缓解

| 风险 | 缓解 |
|------|------|
| Drizzle 查询返回格式与内存版本不一致 | 每个仓库方法在实现后运行对应测试验证 |
| 跨表事务性能 | 仅 auth 注册和 deployments publish/rollback 需要事务 |
| 测试执行时间变长（依赖网络/Docker） | TRUNCATE CASCADE 比 recreate tables 更快；本地 Docker 延迟约 1-2s |
| Windows 兼容性 | PostgreSQL Docker 在 Windows 上可用；测试路径已在前序修复中处理 |
