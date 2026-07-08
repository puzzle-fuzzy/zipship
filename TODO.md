# ZipShip 架构 TODO

> 生成时间：2026-07-08 · 基于对 `apps/api`、`packages/console-app`、`packages/*`、测试与基础设施的全量审查。
> 项目尚未上线，允许大改动。本文件按优先级与模块组织，每条都含 **问题（含文件引用）→ 影响 → 建议**。

## 优先级图例

- **P0 阻塞上线 / 自相矛盾**：文档与代码冲突、无法构建生产产物、数据安全风险。
- **P1 架构债务**：影响可维护性、可测试性、团队协作，应在稳定功能前处理。
- **P2 规范 / 体验 / 未来扩展**：可以滚动改进。

---

## 0. 诊断概览

ZipShip 的**领域建模与分层意图是清晰的**（control-plane / access-plane 分离，module 内 model/service/repository 三层，权限矩阵、release 模型都设计得不错）。当前的主要问题集中在**工程化与一致性**，而不是领域设计：

1. **构建/部署故事基本缺失**——无 API 生产构建、无 Dockerfile、无 CI、nginx 只是模板。
2. **重复代码多**——`parseBearerToken` ×8、前端 `createApiClient` ×13、错误码映射遍布各 store。
3. **横切关注点未抽象**——鉴权、日志、校验、限流都散落或缺失。
4. **测试定位名不副实**——`tests/unit/` 里全是连真实 PostgreSQL 的集成测试；8/9 个包零测试。
5. **文档与实现脱节**——CLAUDE.md 写的是 Electron，实际是 Tauri；catalog 里堆了一堆未用的 Electron 依赖。

好消息：这些都是「上线前一次性还债」的范畴，不涉及推倒重来。

---

## ✅ 完成进度（2026-07-08 本轮执行）

> 本轮按优先级处理了 P0/P1 的绝大部分债务，每步都通过 `typecheck` + 全量测试（99 unit + 104 integration = 203 通过）+ 端到端 smoke 验证。下面是已完成项与有意延后项。

### 已完成

**阶段 0 · 快速止血**（全部）
- [x] 1.1 / 6.2 `desktop-shell` 改名 `@zipship/desktop-shell`；deps 改 `catalog:`；tsconfig ES2020→2022；删 catalog 里 10+ 个未用的 Electron 依赖 + 4 个 eslint 依赖；加 Tauri catalog 条目。
- [x] 6.2 CLAUDE.md / README / docs Electron→Tauri（含端口 5174→1420）。
- [x] 6.5 选定 oxlint，删 eslint 依赖，根加 `lint`/`lint:fix`；turbo 加 `lint`/`build`/`test` 任务。
- [x] 5.1 `tests/unit/` 7 个路由测试迁到 `tests/integration/`（纯逻辑留 unit）；加 `test:unit` / `test:integration` 脚本。
- [x] 7.1 `/_health` 增强：DB `SELECT 1` + 存储根 stat，降级时返回 503。
- [x] 额外：修复了 main 上既有的坏掉的 auth 测试桩（`invalidateSession`/`updateUser`）。

**阶段 1 · API 立柱**（除 2.3 authGuard 外全部）
- [x] 1.2 / 1.3 抽 `apps/api/src/lib/auth.ts`（`parseBearerToken` + `resolveSession`，去重 ×8）与 `lib/normalize.ts`（`normalizeName`/`normalizeEmail`）。
- [x] 2.1 删除 737 行死代码内存仓储 `auth/repository.ts`（确认零引用）。
- [x] 2.2 仓储不再 `throw new Error(string)`：`deployments` 的 2 处防御性 throw 改为返回 `null` + service 映射错误码。
- [x] 2.5 `lib/logger.ts` 结构化日志（JSON 行 + 级别控制），替换 email service 的 `console.log` 与启动日志。
- [x] 4.5 / 2.7 `@zipship/config` 改用 **zod** 校验（URL/端口/必填 fail-fast）；`appUrl`/CORS 收敛；消除 3 处硬编码 `localhost:5173`。
- [x] 2.6 内部模块 `audit`/`release-processing`/`email` 补 `index.ts` barrel + `modules/README.md` 约定。
- [x] 2.4 拆 `createApp` → `createContainer` + `composeHttpApp`（保留 `type App` 推断供 Eden Treaty）。

**阶段 2 · 前端基础**（服务层 + 错误地图 + 容错；巨型组件拆分/表单/i18n 延后）
- [x] 3.1 新建 `console-app/src/api/client.ts`（单例 treaty client + `getAccessToken`/`authHeaders`）+ `api/errors.ts`（`mapApiError` + 统一 `API_ERROR_MESSAGES`）。迁移 3 个 store + 全部调用点，**彻底移除 13 处 `createApiClient`**。
- [x] 3.5 错误码 → 文案映射集中化（去重 + 去硬编码中文）。
- [x] 3.4 顶层 `ErrorBoundary`（渲染崩溃兜底）。路由鉴权由 `App.tsx` 的 status 门控覆盖；lazy/404 为低优先延后。

**阶段 3 · 构建 / 部署 / 基础设施**（全部）
- [x] 6.1 `apps/api` + `apps/web-shell` 加 `build` 脚本（API `bun build` 打包 1.78MB；web `vite build`）；`turbo run build` 全绿。
- [x] 6.3 GitHub Actions CI（`.github/workflows/ci.yml`）：lint + typecheck + unit + integration（postgres service）+ build 三 job。
- [x] 6.4 `apps/api/Dockerfile`（multi-stage bun）；`docker-compose.yml` 加 `api`+`nginx`（`--profile prod`）+ `name: zipship`（修复容器命名 / `db:up` 端口冲突）；加 `infra:up`/`infra:down`。
- [x] 6.7 nginx 加 `${VAR}` 占位符 + `render.sh`（envsubst）；加安全头、gzip、API 限流；TLS/HSTS 注释位。
- [x] 清理全仓未用 import/变量（CI 暴露的潜在债务），含修复 `@zipship/deploy-core` 漏声明 `@zipship/shared` 依赖的真 bug。

**阶段 4a · 审计日志读接口**
- [x] 7.4 新增 `GET /_api/organizations/:organizationId/audit`（member 鉴权 + 复用 `audit_logs` 表）。端到端 smoke：200 返回 `auth.login_succeeded`，未鉴权 401。

**阶段 4b · 成员/邀请生命周期 + 审计 UI + 枚举 SoT**
- [x] 7.2 members `PATCH /:userId`（改角色，含 last-owner 保护）+ `DELETE /:userId`（移除）；invitations `GET /`（列表）+ `DELETE /:invitationId`（撤销）+ `POST /_api/invitations/:token/accept`（接受：鉴权 + 邮箱匹配 + 过期/重复检查）。端到端 smoke 全绿。
- [x] 7.4 审计 UI：`auditStore` + ProjectDetailPage "Activity" tab 展示 org 审计流。审计特性端到端闭环。
- [x] 4.3 `@zipship/shared` 成为 `MemberRole`/`ReleaseStatus`/`DeploymentAction` 的单一事实源；db pgEnum 从 shared 数组派生（drizzle 确认零迁移漂移）。

**阶段 4c · 密码重置**
- [x] 7.3 `password_reset_tokens` 表 + migration（0003）；`POST /_api/auth/password-reset/request`（始终 200，不泄漏邮箱是否存在）+ `POST /_api/auth/password-reset/confirm`（校验 token → 改密 → 作废 token）。`EmailService.sendPasswordReset`（SMTP 真发 / dev 走 logger）。端到端 smoke：旧密码 401、新密码 200、token 一次性复用 → INVALID_TOKEN。

**阶段 5 · 结构性滚动**
- [x] 4.4 `packages/db/src/schema.ts`（原 296 行单文件）按域拆分为 `schema/{_shared,accounts,content,desktop}.ts` + barrel；schema.ts 仅 re-export。drizzle 确认零迁移漂移，104 集成测试通过。
- [x] 5.2（部分）补 `@zipship/shared`（枚举 SoT 契约）+ `@zipship/config`（zod 默认值/URL 校验）单测；这两个包此前零测试。
- [x] 7.5 + 2.3 `api_tokens` 表 + migration（0004）；`api-tokens` 模块（CRUD：创建返回明文 token 一次 / 列表 / 撤销）。**统一鉴权闸门**：`lib/auth.ts` 新增 `resolvePrincipal` + `createSessionOrApiTokenLookup`——resource 模块注入该 composite，即可同时接受 refresh-token 会话（浏览器）与 API token（CLI/CI），**零服务代码改动**。端到端 smoke：API token 可创建项目、撤销后 401、104 集成测试（会话鉴权）全绿。
- [x] 4.1 `StorageAdapter` 接口 + `LocalStorageAdapter`（`packages/storage/src/adapter.ts`）——抽象出可跨后端的 IO 契约；并明确记录 S3 适配需要把「`current` 软链接」重设计为元数据指针（对象存储无软链接），这是上 S3 的关键设计决策。
- [x] 1.5（部分）新增 `toast` i18n namespace（en/zh），把 `ProjectDetailPage`（最严重的硬编码来源）的全部中文 toast/confirm/按钮文案迁到 `t()`；其余 52 处（InviteMemberDialog / UploadVersionDialog / ProfileEditDialog）为机械清扫。
- [x] 3.3（部分）新建 `console-app/src/lib/validation.ts`（zod：`projectSlugSchema`/`projectNameSchema`/`emailSchema`/`passwordSchema`/`createProjectSchema`，与服务端规则对齐）；`CreateProjectDialog` 已接入真实的 slug 格式校验。其余表单（login/invite/profile）复用同 schema 即可。

### 有意延后（建议作为后续专项）

- **3.2 拆巨型组件**（`ProjectDetailPage` / `UploadVersionDialog` / `AppLayout`）、**3.3 zod + react-hook-form 表单**、**1.5 i18n 余下 52 处字符串清扫**：前端无测试网，建议先补 console-app 测试（见下）再大规模重构。
- **4.1（剩余）**：接口 + LocalAdapter 已就位；需把 uploads/release-processing/site-preview 等消费者迁到注入 `StorageAdapter`，并落地 S3 适配（含 `current` 指针重设计）。
- **5.2（剩余）**：`@zipship/shared`/`@zipship/config` 已补；仍缺 `@zipship/storage`（路径解析/symlink swap 边界）与 `packages/console-app`（stores/services，需先搭 vitest + testing-library + MSW）测试。
- **7.6 自定义域名 + 自动 HTTPS**、**7.8 分块可恢复上传**、**7.10 Webhooks**：TODO 已标为 v2 大特性（自定义域名涉及 DNS+TLS 子系统；分块上传需重新设计上传协议；Webhooks 需交付系统），单独立项。

---

## 一、命名与一致性

### 1.1 [P0] `desktop-shell` 缺少 `@zipship/` 作用域
- **问题**：[apps/desktop-shell/package.json](apps/desktop-shell/package.json) `"name": "desktop-shell"`，而 api / web-shell / 所有 packages 都是 `@zipship/*`。
- **影响**：workspace 解析、发布、心智模型不一致。
- **建议**：改名为 `@zipship/desktop-shell`，同步更新所有引用（`bun --filter`、turbo、import）。

### 1.2 [P1] `parseBearerToken` 在 8 个 service 里各写一份
- **问题**：[auth/service.ts](apps/api/src/modules/auth/service.ts)、[organizations](apps/api/src/modules/organizations/service.ts)、[projects](apps/api/src/modules/projects/service.ts)、[deployments](apps/api/src/modules/deployments/service.ts)、[releases](apps/api/src/modules/releases/service.ts)、[uploads](apps/api/src/modules/uploads/service.ts)、[invitations](apps/api/src/modules/invitations/service.ts)、[members](apps/api/src/modules/members/service.ts) 各自定义。
- **影响**：修一个 bug 要改 8 处；行为漂移风险（大小写、前缀处理）。
- **建议**：抽到 `apps/api/src/lib/auth.ts`（或更好的方案：做成 Elysia `guard`/派生 `derive`，见 2.3），各 service 不再自己解析。

### 1.3 [P1] `normalizeName` 等工具函数重复
- **问题**：`normalizeName` 在 auth、projects 两处实现且实现不一致。
- **建议**：统一到 `apps/api/src/lib/normalize.ts`。

### 1.4 [P2] 错误类命名不统一
- **问题**：`UploadServiceError` vs `InvitationsServiceError`（单复数 / 后缀不一致）；storage 里 `ReleaseArtifactNotFoundError` vs `CurrentReleaseLinkError`（`Error` vs `NotFoundError`）。
- **建议**：统一为 `<Domain>Error`（如 `UploadError`、`ReleaseArtifactError`），或全部 `<Thing>NotFoundError`，二选一并写进 CONTRIBUTING。

### 1.5 [P2] 前端 i18n 文件存在，但 50+ 处用户文案绕过它
- **问题**：硬编码中文遍布：
  - [stores/projectsStore.ts:146](packages/console-app/src/stores/projectsStore.ts#L146) `throw new Error('发布失败')`
  - [pages/ProjectDetailPage.tsx](packages/console-app/src/pages/ProjectDetailPage.tsx) 第 138/171/232/234/245/336/338/422/426/429/435/438 行大量 `toast.*('…')` 与 `confirm('确定要删除…')`
  - [features/versions/UploadVersionDialog.tsx](packages/console-app/src/features/versions/UploadVersionDialog.tsx) 几乎整组件硬编码
  - [features/members/InviteMemberDialog.tsx](packages/console-app/src/features/members/InviteMemberDialog.tsx)、[ProfileEditDialog](packages/console-app/src/features/settings/ProfileEditDialog.tsx) 同样
- **影响**：i18n 形同虚设；切英文版会漏一半。
- **建议**：全量替换为 `t('…')`；建立 lint 规则禁止在 JSX/`toast`/`throw new Error` 中出现中文字面量。

### 1.6 [P2] 服务端邮件模板语言硬编码
- **问题**：[modules/email/service.ts:54-65](apps/api/src/modules/email/service.ts) 中文模板写死；[modules/email/service.ts:69-82](apps/api/src/modules/email/service.ts) 用 `console.log`。
- **建议**：模板抽到 `apps/api/src/modules/email/templates/`，按 locale 选择；日志改结构化输出（见 2.5）。

---

## 二、API 后端（apps/api）

### 2.1 [P1] 测试专用代码混入生产源码树
- **问题**：[modules/auth/repository.ts](apps/api/src/modules/auth/repository.ts) 是 737 行的内存版仓储，含 `InMemoryTestRepositoryControls`、`setMemberRoleForTest`、`setReleaseStateForTest`（[organizations/drizzle-repository.ts:43](apps/api/src/modules/organizations/drizzle-repository.ts#L43) 也有 `setMemberRoleForTest`）。它只被少量 service 单测使用，`index.ts` 并未引用。
- **影响**：生产构建里带测试代码；两套实现需要同步维护；新人不清楚该用哪个。
- **建议**：
  - 方案 A（推荐）：**删除内存仓储**。集成测试已经走真实 PG（见第五节），内存版只服务于 auth-login/auth-registration 两个纯逻辑测试——把它们改成对 service 直接断言（注入 stub repository）即可。
  - 方案 B：移到 `apps/api/src/modules/auth/__test-utils__/in-memory-repository.ts`，明确不进生产 bundle。
  - 同时把 `setMemberRoleForTest` / `setReleaseStateForTest` 从 drizzle 仓储接口里挪走，改为测试通过直接 SQL/seed 构造数据。

### 2.2 [P1] 仓储抛异常，service 返回错误对象——错误模型不统一
- **问题**：service 统一返回 `{ ok: false, code }`，但仓储直接 `throw new Error("Project not found")`（[deployments/drizzle-repository.ts:43-48](apps/api/src/modules/deployments/drizzle-repository.ts#L43)、auth/repository.ts 多处）。成员表 `joinedAt` 为 null 时静默 fallback `new Date()`（[members/drizzle-repository.ts:30](apps/api/src/modules/members/drizzle-repository.ts#L30)）。
- **影响**：service 无法类型安全地处理「未找到」；未捕获 throw 会冒泡成 500。
- **建议**：仓储统一返回 `T | null`（或 `Result<T>`），由 service 决定映射成哪个错误码；禁止在仓储里 `throw new Error(string)`。

### 2.3 [P1] 鉴权没有中间件，每个 service 自己 parse + 校验
- **问题**：bearer token 解析散落 8 处（见 1.2）；权限校验是 service 内部 hard-import `PermissionService`（[deployments/service.ts:4](apps/api/src/modules/deployments/service.ts#L4)、[projects/service.ts:22](apps/api/src/modules/projects/service.ts#L22)）。
- **建议**：
  - 用 Elysia 的 `derive` / `guard` 做 `authGuard` 插件，从 header 解析 token → 查 session → 把 `currentUser`、`currentMembership` 挂到请求上下文。
  - 路由层声明所需 action（如 `.guard({ action: 'publish_release' })`），由插件做权限拦截。service 不再关心 HTTP/鉴权，恢复纯业务。

### 2.4 [P1] `createApp` 是上帝函数
- **问题**：[apps/api/src/index.ts](apps/api/src/index.ts) 的 `createApp` 同时负责：CORS、构造全部仓储、构造全部 service、拼装所有模块、test routes、启动 server。
- **建议**：拆成 `createContainer()`（DI 容器，返回 `{ repos, services }`）+ `composeHttpApp(container)`（只组装 Elysia）+ `startServer()`。便于测试只起容器不起 HTTP。

### 2.5 [P1] 没有结构化日志、限流、健康检查
- **问题**：全仓只有 `console.log`（email service）；无 `/health`；无限流（上传端点裸奔）；CORS 只允许 localhost（[index.ts:46-51](apps/api/src/index.ts#L46)，硬编码）。
- **建议**：
  - 引入轻量 logger（pino 或自封装 `{ level, ts, requestId, msg, fields }`），请求中间件注入 `requestId`。
  - 加 `GET /_api/health`（查 DB `SELECT 1` + 存储根可写）。
  - Elysia 限流插件（`@elysiajs/rate-limit` 或自写），至少保护 `auth/login`、`uploads`。
  - CORS allowedOrigins 走 env（`ZIPSHIP_WEB_ORIGIN`）。

### 2.6 [P2] 模块结构不统一
- **问题**：`audit`、`release-processing`、`email` 三个内部模块缺 `index.ts`（非 HTTP 模块，但破坏了「每个模块一个 plugin」的一致性）；`email` 只有 `service.ts`，没有 model/repo。
- **建议**：明确两类模块——`http-module`（有 index.ts 暴露路由）与 `internal-module`（纯 service），在 `apps/api/src/modules/README.md` 写清约定；给 internal 模块也加一个 `index.ts` 仅做 re-export，保持目录结构一致。

### 2.7 [P2] 硬编码 localhost 与配置散落
- **问题**：[index.ts:74](apps/api/src/index.ts#L74)、[index.ts:128](apps/api/src/index.ts#L128)、[invitations/service.ts:110](apps/api/src/modules/invitations/service.ts#L110) 都硬编码 `http://localhost:5173`。
- **建议**：统一走 `@zipship/config`，新增 `webBaseUrl`、`appOrigins` 等字段。

---

## 三、前端（packages/console-app）

### 3.1 [P1] 没有数据层——store/component 直调 treaty，`createApiClient` 重复 13 次
- **问题**：每个 store 方法都 `const api = createApiClient(apiBaseUrl)`（authStore ×4、projectsStore ×6、membersStore ×2），甚至组件 [UploadVersionDialog.tsx:52,56,65,73](packages/console-app/src/features/versions/UploadVersionDialog.tsx) 也在直接 import `createApiClient` 发请求。
- **影响**：无法统一处理鉴权头、错误码、loading；组件耦合 HTTP。
- **建议**：
  - 在 `console-app/src/api/` 建单例 client（app 启动时按 `window.__ZIPSHIP_API_BASE_URL` 创建一次）。
  - 建薄服务层 `services/{auth,projects,members,uploads}.ts`，store 只调 service，service 调 client。
  - 把 upload 三步流水线从 [UploadVersionDialog](packages/console-app/src/features/versions/UploadVersionDialog.tsx) 抽进 `services/uploads.ts`（或 uploadsStore）。

### 3.2 [P1] 上帝组件
- **问题**：[ProjectDetailPage.tsx](packages/console-app/src/pages/ProjectDetailPage.tsx)（465 行，10 个 useState，混 Versions/Members/Settings 三个 tab + 表单 + 删除逻辑）、[UploadVersionDialog.tsx](packages/console-app/src/features/versions/UploadVersionDialog.tsx)（375 行）、[AppLayout.tsx](packages/console-app/src/features/layout/AppLayout.tsx)（4 个 dialog 状态 + 取数 + 建项目逻辑）。
- **建议**：拆 `ProjectDetailPage` → `<VersionsTab/>`、`<MembersTab/>`、`<ProjectSettingsTab/>`，各自配 store；layout 里的 dialog 状态上提到路由或 `uiStore`。

### 3.3 [P1] 表单几乎无校验
- **问题**：CreateProject / InviteMember / ProfileEdit / Login 都只判 `=== ''`；无邮箱格式、无密码强度、无 slug 格式（[CreateProjectDialog](packages/console-app/src/features/projects/CreateProjectDialog.tsx) 的 slug 生成逻辑也该进 utils）。
- **建议**：引入 `zod` + `react-hook-form`（或 `@hookform/resolvers`）；schema 与后端 TypeBox 共享语义（可考虑从后端 schema 生成 zod，或至少手动对齐）。

### 3.4 [P1] 路由无守卫、无懒加载、无错误边界
- **问题**：[router.tsx](packages/console-app/src/router.tsx) 仅 3 条路由，无 lazy import，无 `<ProtectedRoute>`，catch-all 直接跳 `/app` 无 404。
- **建议**：
  - `<ProtectedRoute>`：未登录跳 `/login`（`authStore.initSession` 已有基础）。
  - `React.lazy` + `Suspense` 拆包。
  - 顶层 `<ErrorBoundary>` 兜底渲染异常。
  - 真 404 页。

### 3.5 [P2] 错误码 → 文案映射重复
- **问题**：authStore / projectsStore / membersStore 各自维护一份 `code → message`。
- **建议**：抽到 `i18n/errors.ts`，配合 `mapApiError(code)` 统一调用。

### 3.6 [P2] 组件归类混淆
- **问题**：[components/ui/avatar-dropdown.tsx](packages/console-app/src/components/ui/avatar-dropdown.tsx)（业务组件）与 shadcn 原子组件混在 `ui/`。
- **建议**：`ui/` 只放通用原子组件；业务组件进对应 `features/` 或新增 `components/app/`。

### 3.7 [P2] 用了原生 `confirm()`
- **问题**：[ProjectDetailPage.tsx:422](packages/console-app/src/pages/ProjectDetailPage.tsx#L422) `if (!confirm(...))`。
- **建议**：项目里已有 `confirm-dialog.tsx`，统一用它。

### 3.8 [P2] `apiBaseUrl` 经 `window.__ZIPSHIP_API_BASE_URL` 全局传递
- **建议**：可保留（Vite 注入 ok），但应封装成单一 `getApiBaseUrl()`，避免散落读取；类型声明放进 `runtime` 或 `shared`。

---

## 四、共享包（packages/*）

### 4.1 [P1] `@zipship/storage` 名不副实——无抽象，只有本地实现
- **问题**：[packages/storage/src/index.ts](packages/storage/src/index.ts)（241 行）全是 `fs/promises`，无 `StorageAdapter` 接口，还耦合了 `await Bun.write(...)`（[index.ts:94](packages/storage/src/index.ts#L94)）；CLAUDE.md 承诺的 S3/MinIO 只是 TODO。纯路径工具函数（18-63 行）也混在里面。
- **影响**：换存储后端要改调用方；Bun API 耦合让包无法在其它 runtime 复用。
- **建议**：
  - 定义 `interface StorageAdapter { writeFile/readFile/stat/delete/exists/symlink/... }`。
  - `LocalStorageAdapter` 实现它；API 只依赖 `StorageAdapter` 接口，由 DI 注入实现。
  - 路径工具移到独立的 `@zipship/paths`（或并入 `shared`）。
  - 用 `node:fs` 替换 `Bun.write`（或走 adapter 接口）。

### 4.2 [P2] `@zipship/deploy-core` 含 Node 专属 API，但未声明边界
- **问题**：[unzip.ts](packages/deploy-core/src/unzip.ts)、[hash.ts](packages/deploy-core/src/hash.ts)、[detect.ts](packages/deploy-core/src/detect.ts)、[manifest.ts](packages/deploy-core/src/manifest.ts) 直接用 `fs` / `node:crypto`。
- **澄清**：deploy-core 实际只在 **服务端**（API 的 release-processing）运行，浏览器侧解压走的是 JSZip，所以**当前并不算 bug**。但 package 没有声明「server-only」，容易被误用到客户端。
- **建议**：在 package README 明确「server-only」；若未来想统一抽取逻辑，需通过 `StorageAdapter`/`RuntimeAdapter` 注入 IO，去掉裸 `fs`。

### 4.3 [P2] `@zipship/shared` 与 `@zipship/db` 枚举类型重复定义
- **问题**：`MemberRole`/`ReleaseStatus`/`DeploymentAction` 既在 [packages/db/src/schema.ts](packages/db/src/schema.ts) 的 pgEnum 里，又在 [packages/shared](packages/shared/src/index.ts) 重新声明 union。
- **建议**：让 `shared` 成为单一事实源（union 类型），`db` 的 pgEnum 从 shared 派生；避免两处漂移。

### 4.4 [P2] `packages/db/schema.ts` 单文件 296 行
- **建议**：按域拆分 `schema/{users,organizations,projects,releases,deployments,audit}.ts`，`index.ts` 聚合 re-export。

### 4.5 [P2] `@zipship/runtime` 过小（1 个方法），`@zipship/config` 非类型安全
- **问题**：`runtime` 只有 `openExternal`；`config` 全是 `process.env.X ?? default`，无运行时校验，且 [packages/db/drizzle.config.ts:8](packages/db/drizzle.config.ts#L8) 等处绕过 config 直接读 env。
- **建议**：
  - `runtime` 可暂时并入 `shared`（或保留但接受它会长大）。
  - config 用 zod 校验启动时必填项，缺失即 fail-fast；drizzle.config 等也走 config。

### 4.6 [P2] `@zipship/api-client` 与 `@zipship/api` 存在 dev-期类型耦合
- **问题**：[packages/api-client/src/index.ts](packages/api-client/src/index.ts) `import type { App } from "@zipship/api"`。属 type-only，无运行时循环，但 api-client 无法独立 typecheck。
- **建议**：可接受现状（Elysia Eden 推荐用法），但要在 turbo 里把 `@zipship/api` 的构建/类型生成排在 api-client 之前；或在 `apps/api` 导出独立 `types.ts` 供消费。

---

## 五、测试

### 5.1 [P1] `tests/unit/` 名不副实——其实是集成测试
- **问题**：`tests/unit/*-routes.test.ts` 全部连真实 PostgreSQL（`createTestDbClient(TEST_DATABASE_URL)` + `truncateAllTables`），CLAUDE.md 也承认「Route-level tests use the real PostgreSQL」。真正纯单元的只有 `auth-login`、`auth-registration`、`project-slug`、`permissions`、`audit-service`。
- **影响**：命名误导；跑「单元测试」必须先起 Docker，CI 慢。
- **建议**：目录重命名/重组为：
  - `tests/unit/` —— 不依赖 DB/IO 的纯逻辑（保留 auth-login、auth-registration、project-slug、permissions、audit-service 中的纯断言部分）。
  - `tests/integration/` —— 连真实 PG 的路由测试（现 `*-routes.test.ts`、`storage-static`、`site-preview`）。
  - `tests/e2e/` —— 保持。
  - `bun test` 默认跑全部；新增 `bun run test:unit` / `test:integration`。

### 5.2 [P1] 8/9 个包零测试
- **问题**：仅 `deploy-core` 有测试。`console-app`（36 源文件）、`db`、`storage`、`config`、`shared`、`runtime`、`api-client` 全无。
- **建议**：优先补：
  - `storage`（路径解析、symlink swap 的边界——这是核心安全逻辑）。
  - `shared`（reserved slugs 校验，纯函数，零成本）。
  - `console-app` 的 stores/services（用 MSW mock treaty）。
  - `config` 的 env 校验。

### 5.3 [P2] 测试 colocate 与外置不一致
- **问题**：所有测试外置于 `tests/` 或 `packages/*/tests/`，无 `*.test.ts` 紧邻源码；`tests/README.md` 提到根级 `fixtures/` 但实际只有 `deploy-core/tests/fixtures/`。
- **建议**：定一个统一策略（推荐纯函数/组件 colocate `foo.test.ts`，跨模块集成放 `tests/integration`），更新 `tests/README.md` 与事实一致。

### 5.4 [P2] 测试辅助太少
- **问题**：仅 [tests/helpers/path.ts](tests/helpers/path.ts) 一个 helper；建用户、建项目、发 token 等样板在每个路由测试里重复。
- **建议**：补 `tests/helpers/fixtures.ts`（`createVerifiedUser`、`createOrgWithProject`、`loginAndGetToken` 等），降低每个测试的 setup 噪音。

---

## 六、构建 / 部署 / 基础设施

### 6.1 [P0] 无生产构建脚本
- **问题**：[apps/api/package.json](apps/api/package.json) 只有 `dev`，无 `build`；[apps/web-shell/package.json](apps/web-shell/package.json) 也无 `build`。`.gitignore` 忽略了 `dist`/`build` 但没有脚本产生它们。
- **影响**：无法上线。
- **建议**：
  - api：`bun build src/index.ts --target bun --outdir dist`（或保留 `bun run src/index.ts` 直接跑，但需明确生产启动命令）。
  - web-shell：`vite build`。
  - 根 `package.json` 加 `build`（`turbo run build`），turbo.json 加 `build` task。

### 6.2 [P0] 文档说 Electron，实际是 Tauri；catalog 堆满未用的 Electron 依赖
- **问题**：
  - [CLAUDE.md:16](CLAUDE.md) 写「Electron shell」，但 [apps/desktop-shell/src-tauri/Cargo.toml](apps/desktop-shell/src-tauri/Cargo.toml)、[tauri.conf.json](apps/desktop-shell/src-tauri/tauri.conf.json)、[package.json](apps/desktop-shell/package.json) 全是 **Tauri**。
  - 根 [package.json](package.json) catalog 里有 10+ 个 `@electron-forge/*`、`electron`、`electron-squirrel-startup` 等——**全部未用**。
- **影响**：误导；安装额外数百 MB 依赖；CI/构建时间浪费。
- **建议**：从 catalog 删掉所有 Electron 条目；CLAUDE.md 改为 Tauri；desktop-shell 的 deps 改用 `catalog:`/`workspace:`（当前硬编码版本，与 monorepo 约定不符）。

### 6.3 [P0] 无 CI/CD
- **问题**：无 `.github/workflows/`（已确认目录不存在）。
- **建议**：加 GitHub Actions：PR 触发 `lint` + `typecheck:workspaces` + `test`（带 Postgres service container）；main 触发 `build`。

### 6.4 [P0] 无 Dockerfile / 无生产编排
- **问题**：[infra/docker/docker-compose.yml](infra/docker/docker-compose.yml) 只有 postgres；无 API 容器、无 nginx 容器、无 Dockerfile。[infra/scripts/](infra/scripts/) 只有空 README。
- **建议**：
  - `apps/api/Dockerfile`（multi-stage：install → build → runtime，基于 `oven/bun`）。
  - docker-compose 扩展为 `postgres + api + nginx`，加 `depends_on` 与网络。
  - nginx 配置的 `__ZIPSHIP_*__` 占位符需要渲染脚本（envsubst）——补 `infra/scripts/render-nginx.sh`。

### 6.5 [P1] lint 配了但不全 / ESLint 依赖在 catalog 但无配置
- **问题**：已有 [.oxlintrc.json](.oxlintrc.json)（oxlint，correctness=error），但根 package.json 无 `lint`/`format` 脚本；catalog 里却躺着 `eslint`、`@typescript-eslint/*`、`eslint-plugin-import`（无任何 eslint 配置）。
- **建议**：**选定 oxlint**（已选，更快），删除 catalog 里未用的 eslint 依赖；根加 `"lint": "oxlint ."`、`"lint:fix": "oxlint --fix ."`；可选加 `prettier` 或 `biome` 做 format；turbo.json 加 `lint` task。

### 6.6 [P1] turbo.json 几乎是空的
- **问题**：[turbo.json](turbo.json) 只有 `typecheck`（outputs 为空）和 `dev`；无 `test`/`build`/`lint`；缓存未利用。
- **建议**：补全 task，给 `build`（outputs `dist/**`）、`typecheck`、`test`、`lint` 配置 `inputs`/`outputs` 以命中缓存。

### 6.7 [P1] nginx 安全/性能基线缺失
- **问题**：[infra/nginx/zipship.conf](infra/nginx/zipship.conf)：
  - 仅 HTTP，无 TLS/HTTPS、无 HSTS、无 HTTP→HTTPS 跳转。
  - 无安全头（`X-Frame-Options`、`CSP`、`X-Content-Type-Options`、`Referrer-Policy`）。
  - 无 `gzip`/`brotli`。
  - 无 `limit_req` 限流。
  - `client_max_body_size 500m`（上传合理，但需配合后端校验防 DoS）。
  - 占位符无渲染机制。
- **建议**：补 TLS（Let's Encrypt / Caddy 前置亦可）、安全头、压缩、限流；上传大小由 config 驱动。

### 6.8 [P2] env 未做启动校验
- **问题**：`.env` 已确认 **未被 git 追踪**（无泄密），但代码无必填校验，缺关键 env 时会运行时才崩。
- **建议**：见 4.5——config 用 zod 在启动时校验。

### 6.9 [P2] desktop-shell tsconfig target 与 base 不一致
- **问题**：[apps/desktop-shell/tsconfig.json](apps/desktop-shell/tsconfig.json) `target: ES2020`，base 是 `ES2022`。
- **建议**：统一为 ES2022；考虑用 TS project references 替代当前的 `include` glob 方案。

---

## 七、缺失功能（对一个静态部署平台而言）

> 现有：auth（register/login/me/logout）、orgs、projects、members（只读）、invitations（只发）、releases（只读）、deployments（publish/rollback）、uploads、site-preview、permissions、audit（内部）、email。
> 以下是明显缺口，按价值排序。

### 7.1 [P0] 健康检查端点
- `GET /_api/health`（DB + 存储 + 可选 nginx 探活）。无它则无法做就绪/存活探针与监控。

### 7.2 [P1] members / invitations 半成品
- **问题**：members 只有 `GET`，无法改角色/移除（尽管权限矩阵有 `manage_member`）；invitations 只有 `POST`，无 list / revoke / **accept**（被邀请人怎么加入？）。
- **建议**：补 `PATCH /members/:id`（改角色）、`DELETE /members/:id`（移除）；invitations 补 `GET`、`DELETE`、`POST /invitations/:token/accept` + `POST /invitations/:token/decline`，邮件正文带 accept 链接。

### 7.3 [P1] 密码重置 / 邮箱验证
- 已有 nodemailer SMTP，却没有「忘记密码」「注册邮箱验证」。这是上线前基本项。
- **建议**：reset token 表（或复用 sessions 思路）+ `/auth/password-reset/request` 与 `/auth/password-reset/confirm`；注册发验证邮件。

### 7.4 [P1] 审计日志无 UI / 无查询接口
- **问题**：`audit` 是内部 service 只写不读；用户无法看「谁在何时发布/回滚」。
- **建议**：`GET /projects/:id/audit`（按权限）+ 控制台审计页。

### 7.5 [P1] API Token / 个人访问令牌
- **问题**：当前只有 session（7 天 refresh token），无法做 CI 部署（`zipship deploy` CLI 场景）。
- **建议**：`api_tokens` 表 + `POST /tokens`、`DELETE /tokens/:id`，token 同样 SHA-256 存储。

### 7.6 [P2] 自定义域名 / HTTPS 自动签发
- Netlify/Vercel 的核心卖点。当前只有 `/_sites/:slug/:hash/` 内部预览。
- **建议**：`custom_domains` 表 + 域名所有权验证 + Caddy/Let's Encrypt 自动签发 + nginx 按 host 路由到对应 release。可作为 v2 大特性。

### 7.7 [P2] 预览环境访问控制
- 预览 URL 当前公开。补可选密码保护 / IP 白名单。

### 7.8 [P2] 上传健壮性
- 当前三步上传无断点续传、无并发分片；大文件失败需重传。
- **建议**：分块上传 + 可恢复（upload_tasks 已有状态机基础）。

### 7.9 [P2] 可观测性 / 备份
- 无 metrics（Prometheus）/ traces（OTel）/ 错误追踪（Sentry）；无 PG 定时备份脚本。
- **建议**：至少加结构化日志（2.5）+ PG `pg_dump` cron 脚本进 `infra/scripts/`。

### 7.10 [P2] Webhooks / 部署通知
- publish/rollback 成功后触发用户配置的 webhook（Slack/CI）。

---

## 八、推荐落地顺序（路线图）

> 原则：先「止血」（能上线），再「还债」（好维护），最后「增值」（新功能）。每阶段都可独立交付。

### 阶段 0 · 快速止血（0.5～1 天）
- [ ] 6.2 删除 catalog 里未用的 Electron 依赖；CLAUDE.md 改 Tauri；desktop-shell 改 `@zipship` 作用域 + 用 `catalog:`
- [ ] 1.1 desktop-shell 改名 `@zipship/desktop-shell`
- [ ] 5.1 `tests/unit/` → `tests/integration/` 重命名（纯逻辑留在 unit）
- [ ] 6.5 删 catalog 的 eslint 依赖；根加 `lint`/`lint:fix`（oxlint）
- [ ] 7.1 加 `GET /_api/health`
- [ ] 6.6 turbo.json 补 `lint`/`build`/`test` task

### 阶段 1 · API 立柱（1～2 周）
- [ ] 1.2 抽 `lib/auth.ts`（parseBearerToken 去重）
- [ ] 2.3 实现 `authGuard` 插件（鉴权 + 权限中间件化）
- [ ] 2.5 引入结构化 logger + requestId；加限流
- [ ] 2.2 仓储统一返回 `null`/`Result`，去 throw
- [ ] 2.1 删除/迁移内存仓储与 `*ForTest` 方法
- [ ] 2.4 拆 `createApp` → container + httpApp + startServer
- [ ] 4.5 config zod 校验 + 收敛 env 读取
- [ ] 2.6 内部模块补 index.ts 并写模块约定

### 阶段 2 · 前端重构（1～2 周）
- [ ] 3.1 建 `api/` 单例 client + `services/` 层，store 不再直调 treaty
- [ ] 3.5 统一错误码→文案映射
- [ ] 3.2 拆 ProjectDetailPage / UploadVersionDialog / AppLayout
- [ ] 3.3 引入 zod + react-hook-form
- [ ] 3.4 ProtectedRoute + lazy + ErrorBoundary + 404
- [ ] 1.5 i18n 全量替换硬编码中文 + lint 规则

### 阶段 3 · 构建与基础设施（1 周）
- [ ] 6.1 api/web-shell 加 `build` 脚本
- [ ] 6.4 API Dockerfile + 扩展 docker-compose（api+nginx+postgres）
- [ ] 6.3 GitHub Actions CI（lint+typecheck+test+build）
- [ ] 6.7 nginx 加 TLS/安全头/压缩/限流 + 占位符渲染脚本
- [ ] 6.8 启动时 env 校验

### 阶段 4 · 补齐功能缺口（2～3 周）
- [ ] 7.2 members 改角色/移除 + invitations accept/revoke
- [ ] 7.3 密码重置 + 邮箱验证
- [ ] 7.4 审计日志接口 + UI
- [ ] 7.5 API Token
- [ ] 7.9 PG 备份脚本 + 结构化日志接入

### 阶段 5 · 深度抽象与扩展（滚动）
- [ ] 4.1 StorageAdapter 抽象（为 S3 铺路）
- [ ] 4.4 schema.ts 按域拆分
- [ ] 4.3 shared/db 枚举单一事实源
- [ ] 5.2 补 storage/shared/console-app 测试
- [ ] 7.6 自定义域名 + 自动 HTTPS（v2 大特性）
- [ ] 7.8 分块可恢复上传
- [ ] 7.10 Webhooks

---

## 附：可直接复制的 lint 约束建议

- 禁止在 `*.tsx` / `toast.*(` / `throw new Error(` 中出现中文字面量（custom oxlint/eslint rule 或简单 grep CI 检查）。
- 禁止从 `packages/console-app` 直接 import `createApiClient`（只允许从 `api/` 单例导出）。
- 禁止在 service 内 import 另一个 service 的具体实现（强制走 DI）。
- 禁止在 repository 内 `throw new Error(string)`（强制返回 null/Result）。
