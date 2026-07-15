# ZipShip Rust 第二阶段重构方案

> 状态：Approved Direction / Full Replacement
> 分支：`rust-dev`
> 原则：项目尚未上线，不保留旧 API、旧数据库或旧发布模型的兼容性；按最终架构直接建设并完整替换。

## 1. 核心判断

Rust 重构覆盖发布系统中需要强一致性、可恢复任务、流式 IO、并发安全和长期稳定运行的全部服务端能力：控制面 API、Artifact 处理、后台 Worker、存储抽象和访问平面。

现有 React Console 已经覆盖核心项目流程，重新用 Rust/WASM 编写不会直接提高发布可靠性，反而会同时引入 UI 与后端双重迁移风险。因此第二阶段建议：

- **保留** React + Vite + Tailwind + Zustand Console。
- **保留** Tauri 作为桌面壳，但暂不把业务逻辑搬进 Tauri Rust 进程。
- **删除并替换** Elysia API、Drizzle Repository、deploy-core、服务端本地 Storage 实现和 Nginx 动态项目配置；不建设双写、兼容路由或旧数据迁移。
- **新增** Rust Worker、可靠任务表、Rust Access Plane、OpenAPI 契约与生成的 TypeScript Client。

现有 TypeScript 服务端代码只作为需求和测试样例参考，不再作为运行时兼容目标。Rust API 直接使用最终 `/_api` 路径和全新 PostgreSQL schema；Console 在 Rust 核心接口完成后一次性切换到生成 Client。

## 2. 技术选择

### 2.1 Web 框架：Axum

建议采用：

- `axum`：HTTP 路由与提取器。
- `tokio`：异步运行时。
- `tower` / `tower-http`：中间件、超时、限流、压缩、追踪、CORS、请求 ID。
- `serde`：序列化与 API DTO。
- `utoipa`：OpenAPI Schema 与文档生成。
- `thiserror`：领域/应用错误；`anyhow` 仅用于 binary 启动和基础设施边界。
- `tracing` / `tracing-subscriber`：结构化日志和 Trace。
- `metrics` + Prometheus exporter：运行指标。
- `secrecy`：敏感配置包装。
- `argon2`：密码 Hash，参数显式版本化。

选择 Axum 的原因：生态成熟、Tower 中间件边界清晰、与 Tokio/SQLx 配合自然，适合构建控制面和流式访问平面；相比 Actix-web，Axum 的类型和中间件模型更容易与领域层隔离；相比使用较新的全栈 Rust Web 框架，长期维护风险更低。

### 2.2 数据库：继续使用 PostgreSQL，ORM 选择 SQLx

建议不切换 SQLite。即使当前没有正式数据，PostgreSQL 仍更符合产品方向：

- 成员/RBAC、审计、邀请、Token、任务和部署状态需要并发事务。
- Worker 可以用 `FOR UPDATE SKIP LOCKED` 安全 claim 任务。
- 支持约束、部分唯一索引、JSONB、LISTEN/NOTIFY 和成熟备份方案。
- 未来拆分多 Worker、多实例 API 或 S3 存储时无需再次换库。

SQLx 相比 SeaORM/Diesel 更适合本项目：

- 关键发布事务需要显式 SQL 和明确锁语义。
- 编译期 SQL 校验可以发现字段和类型漂移。
- migrations 简单透明，不让 ORM 隐藏并发和状态迁移。
- Repository 层仍返回领域类型，SQLx 不进入 Domain/Application 层。

SQLite 仅适合作为未来的“完全单机个人版”可选后端，不应成为 v2 主数据库。

### 2.3 边缘与 HTTPS：Caddy + Rust Access Plane

建议停止生成并 reload Nginx 项目片段：

- Caddy 负责 TLS、HTTP/2/3、压缩和边缘反向代理。
- Rust Access Plane 根据请求 Host、Slug 和 Release Hash 动态解析项目与版本。
- 自定义域名通过数据库状态控制；Caddy On-Demand TLS 使用 Rust `ask` 端点确认域名是否已验证，防止任意证书签发。
- Rust 负责静态文件安全解析、MIME、ETag、Range、缓存头和 SPA fallback。

这样项目设置不再需要写 Nginx 配置文件，也不需要 reload；发布事务提交后，访问平面只更新活动版本缓存。

## 3. 建议的 Rust Workspace

```text
Cargo.toml                       # Rust workspace
services/
  zipshipd/                     # 控制面 API + Access Plane binary
  zipship-worker/               # Artifact/Runtime/Webhook 后台 Worker
crates/
  zipship-domain/               # 实体、值对象、状态机、错误；无 IO
  zipship-application/          # Use cases、权限、事务边界、Ports
  zipship-postgres/             # SQLx repositories、migrations
  zipship-storage/              # Local/S3 ArtifactStore adapters
  zipship-artifact/             # ZIP 安全解压、检测、Manifest、Hash
  zipship-api/                  # Axum routes、DTO、OpenAPI、middleware
  zipship-access/               # Host/slug/version 路由、静态流式响应
  zipship-jobs/                 # claim/lease/heartbeat/retry/sweep
apps/
  web-shell/                    # 保留现有 React Console
  desktop-shell/                # 保留 Tauri 壳，后续接原生能力
packages/
  api-client/                   # 由 OpenAPI 生成的 TypeScript Client
  console-app/                  # 保留现有 UI，逐步迁移 Client
```

`zipship-domain` 不依赖 Axum、SQLx、Tokio 文件系统或对象存储 SDK；依赖方向只能从外层指向内层。

## 4. 新的数据与 Artifact 模型

### 4.1 核心实体

- `users`
- `web_sessions`
- `api_tokens`
- `organizations`
- `memberships`
- `projects`
- `project_domains`
- `artifacts`
- `releases`
- `deployments`
- `uploads`
- `jobs`
- `audit_logs`
- `webhook_endpoints`
- `webhook_deliveries`

### 4.2 Artifact 与 Release 分离

`Artifact` 表示内容本身，`Release` 表示项目中的一个版本：

```text
artifacts
  id
  sha256                 # 完整 64 位十六进制，唯一
  storage_key            # blobs/sha256/ab/cd/<full-hash>/
  file_count
  total_size
  manifest
  detect_report
  state                  # staging/ready/quarantined/deleting

releases
  id
  project_id
  artifact_id
  version_number
  state                  # processing/ready/failed/archived；active 不是 Release 状态
  created_by
  created_at
```

相同内容重复上传可以创建新的 Release，但复用同一个不可变 Artifact；上传过程绝不能删除或覆盖已 ready 的 Blob。

### 4.3 活动版本只有一个事实源

独立的 `project_active_releases(project_id, release_id)` 是线上版本唯一事实源，并以复合外键保证 Release 属于同一 Project。发布事务：

1. 锁定 Project 行。
2. 校验目标 Release 属于该 Project、状态为 ready、Artifact 可用。
3. 使用幂等键检查重复请求。
4. Upsert `project_active_releases`。
5. 写 Deployment 与 Audit。
6. 提交事务。
7. 通过 PostgreSQL NOTIFY 或内部事件更新 Access Plane 缓存。

文件系统不再维护 `current` 软链接，从根源上消除 DB/FS 双写。

## 5. 上传与后台任务

### 5.1 上传

第一条 Rust 纵向切片先实现流式单文件上传：

- 请求体流式写入 staging 文件，不把整个文件读入内存。
- 写入时计算 SHA-256、统计大小并强制最大限制。
- 临时文件名由服务端生成，忽略用户提供的路径部分。
- 完成后创建持久化 Processing Job，HTTP 返回 `202 Accepted`。
- Console 通过 SSE 获取进度；轮询作为降级方案。

分块/断点续传放在第二个迭代，可采用自定义 Upload Session 或兼容 tus 协议，但不阻塞第一条完整 Rust 发布链路。

### 5.2 Job 表最小字段

```text
id, kind, domain_id, status, priority
attempts, max_attempts, next_run_at
locked_by, locked_until, heartbeat_at
input_json, output_json, error_code, error_detail
created_at, started_at, finished_at, cancelled_at
```

Worker 使用 `FOR UPDATE SKIP LOCKED` claim；任务执行必须幂等。Worker 定期 heartbeat，Sweeper 回收过期 lease，进程启动时恢复非终态任务。

Runtime Check 和 Webhook Delivery 都使用同一任务框架，但各自有独立 kind、重试策略和并发限制。

## 6. ZIP 与静态文件安全

Rust 版必须保留并强化现有 deploy-core 的安全基线：

- 拒绝绝对路径、Windows Drive、UNC、NUL、`..`、编码后穿越和反斜杠穿越。
- 拒绝 ZIP symlink/hardlink、重复规范化路径和大小写碰撞。
- 限制压缩包大小、文件数、单文件解压大小、总解压大小、目录深度和压缩比。
- 解压时使用安全创建语义，不能跟随 staging 目录内的符号链接。
- Manifest 按规范化路径稳定排序，以完整内容 Hash 生成 Artifact ID。
- 静态访问再次执行根目录边界检查，不能假设“上传时已安全”就跳过运行时防护。
- 为路径规范化和 ZIP entry 验证增加 `proptest` 与 fuzz target。

## 7. 认证与授权

### Web Session

- 使用随机高熵 Session Token，数据库仅保存 Hash。
- 浏览器通过 `HttpOnly; Secure; SameSite=Lax/Strict` Cookie 使用。
- 所有修改请求增加 CSRF 防护；登录、注销、改密和 Token 操作写审计。
- 改密、账号停用时撤销现有 Session。

### API Token

- 使用独立前缀和表结构。
- 支持 scope，例如 `projects:read`、`releases:upload`、`deployments:write`。
- 支持过期时间、last_used_at、revoked_at 和描述性名称。
- 明文只在创建时返回一次。

### RBAC

- 保留 owner/admin/developer/deployer/viewer 语义。
- 权限矩阵放在 Domain 层，Route 只做提取和错误映射。
- Repository 不自行决定权限。

## 8. API 契约

- Rust API 直接使用最终 `/_api` 路径，不增加 `/v2`，也不提供旧 Elysia 兼容层。
- 所有错误保持 `{ code, requestId, details? }`，`code` 是稳定协议，前端负责 i18n。
- Rust 通过 `utoipa` 输出 OpenAPI JSON。
- CI 生成并校验 TypeScript Client；生成结果有变更时必须显式提交。
- Console 在 Rust 核心接口完备后一次性从 Eden Client 切换到生成 Client；开发阶段可以按模块实现，但不交付双 Client 运行模式。
- Job 状态通过 SSE 推送；断线后客户端使用 Last-Event-ID 或重新查询当前状态。

## 9. 可观测性与配置

- 每个请求、Job、Deployment、Webhook Delivery 均有 request/trace/correlation ID。
- `tracing` 输出 JSON；敏感 Header、Cookie、Token、Webhook Secret 永不记录。
- Prometheus 指标至少覆盖请求延迟、状态码、活跃上传、Job backlog、处理耗时、失败率、发布耗时和存储空间。
- `/health/live` 只检查进程，`/health/ready` 检查数据库、存储和迁移版本。
- production 环境缺少数据库、Cookie 密钥、外部 URL、存储根等必填配置时拒绝启动。
- 数据库迁移由独立 migration command/job 执行，多个实例启动时使用 advisory lock。

## 10. 测试策略

### Domain/Artifact 单元测试

- 权限矩阵、Release/Deployment/Job 状态迁移。
- Slug、Domain、路径规范化、Cache Policy。
- Manifest/Hash 确定性和 ZIP 安全边界。

### Repository/Integration

- SQLx migrations 在真实 PostgreSQL 上运行。
- 每个测试使用独立 database/schema 或 testcontainers。
- 覆盖唯一约束、并发发布、Job claim、lease 回收和幂等键。

### Contract

- OpenAPI snapshot。
- Rust 响应与生成 TypeScript Client 的契约测试。
- 保持稳定错误码和权限行为。

### E2E/Production Smoke

- Playwright 只存在于测试/专用 Runtime Checker 容器，不进入 API binary。
- 完整链路：注册 → 创建项目 → 上传 → 等待处理 → 预览 → 发布 → 回滚。
- 故障注入：Worker 中断、数据库短暂断开、重复 complete、并发发布、存储空间不足。
- Docker Compose 在 CI 中完成一次从空环境启动的 smoke。

## 11. 迁移阶段

### R0：Rust 基座

- 建立 Cargo workspace、fmt/clippy/deny/audit、CI 和配置框架。
- 建立 PostgreSQL 新 migrations、Domain 类型、错误码和 OpenAPI 骨架。
- 将 Rust 服务设为 `rust-dev` 的唯一目标后端；不维护旧 API 的构建、测试或数据库兼容性。
- 旧 TypeScript 服务端代码在 Rust 纵向切片覆盖其核心行为后直接删除，不设置双栈运行期。

### R1：最小纵向切片

- Rust 注册/登录、组织、项目。
- 流式上传、Job Worker、安全解压、Artifact/Release。
- Rust Preview、Publish、Rollback。
- 使用独立测试页面或生成 Client 完成端到端验证。

完成标准：Rust 路径独立跑通核心价值链，并通过崩溃恢复和并发发布测试。

### R2：Console 切换

- 生成 TypeScript Client。
- 按 auth → projects → uploads/releases → deployments → members/settings 完成所有 Store 改造后一次性切换。
- 接入 SSE 进度和新的 Cookie Session。
- 补齐 logout 与密码重置 UI。
- 删除 Eden Client、`@zipship/api` 类型依赖和旧会话存储逻辑。

### R3：生产访问平面与运维

- Rust Access Plane + Caddy。
- 自定义域名验证、自动 HTTPS。
- Artifact GC、配额、备份、指标和告警。
- 完整生产 Compose 与升级/回滚说明。

### R4：收尾

- 对照最终产品功能矩阵确认 Rust 系统完整，不以旧实现的缺失能力作为范围上限。
- 确认 Elysia/Drizzle/deploy-core/旧 migrations 和兼容代码已经全部删除。
- 保留必要的 TypeScript UI、生成 Client 和 Tauri 壳。
- 发布 v1 前执行恢复演练、安全审查和长时间稳定性测试。

## 12. 明确不做的事情

- 不在 R0/R1 把 React Console 改写成 Rust/WASM。
- 不一开始拆成大量独立微服务；API 与 Access Plane 可先同 binary、不同 Router/监听端口，Worker 独立进程。
- 不在第一条纵向切片同时实现 S3、断点续传、自定义域名和 Desktop 原生功能。
- 不复用旧数据库表、不迁移旧测试数据、不维持旧 API；当前无生产数据，直接建立最终的新 schema。
- 不让 Caddy/Nginx 配置或文件系统软链接成为项目活动版本的业务事实源。

## 13. 第一条实现任务建议

第二阶段第一条代码任务应当是一个真实但最小的纵向切片，而不是只生成空 crate：

1. 创建 Cargo workspace、`zipship-domain`、`zipship-postgres`、`zipship-api`、`zipship-worker` 和两个 binary。
2. 建立新 PostgreSQL migrations：users、sessions、organizations、memberships、projects、artifacts、releases、uploads、jobs、deployments。
3. 实现 Health、注册/登录、创建项目。
4. 实现一个流式 ZIP 上传和持久化 Job。
5. Worker 完成安全解压、Manifest 与 ready Release。
6. Access Plane 提供固定 Release Preview。
7. 实现基于 DB 活动版本指针的 Publish/Rollback。
8. 用真实 PostgreSQL 和临时目录完成端到端测试。

这条切片完成后，再决定 Console 切换速度和旧 TypeScript 后端的退场时间。

### 2026-07-15 实施进度

- 第 1～5 项已完成：Workspace 与基础设施、全新数据库模型、认证、个人组织、成员/项目、流式 ZIP 接收、持久化 Job 和独立 Artifact Worker 均已进入 Rust 实现。
- 上传采用“创建预留 → 原始 Body 流式写入 → 完成入队”三步协议；数据库 transfer lease 与文件 `.part` 生命周期允许中断后重传，`/complete` 并发或重复调用不会重复创建 Release/Job。
- Worker 使用 `SKIP LOCKED`、heartbeat、lease sweep、指数退避和最大尝试次数实现可恢复执行；安全解压、稳定 Manifest、完整 SHA-256、不可变 Artifact 提交以及 ready/failed 状态收敛均已完成。
- PostgreSQL 事务测试覆盖注册时组织创建、角色隔离、项目审计、并发 Slug、上传重试、幂等入队、并发 Job、租约恢复和 Artifact 状态收敛；Rust 全工作区现有 58 项常规测试和 7 项真实 PostgreSQL 集成测试。
- 第 8 项已有一条真实 HTTP 上传 → PostgreSQL Job → Worker → 不可变 Blob/ready Release 链路；完整发布链路仍需第 6、7 项完成后再闭环。
- 下一项进入第 6 项：实现固定 Release Preview Access Plane，包括安全路径解析、MIME、ETag、Range、缓存头和 SPA fallback。
- 项目更新/删除暂不开放；删除必须与活动版本下线、Artifact 保留策略和 GC 状态机一起交付。
