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
- 支持 scope，例如 `projects:read`、`releases:read`、`uploads:write`、`deployments:write`。
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

- 第 1～8 项已完成，R1 最小 Rust 纵向切片闭环：Workspace 与基础设施、全新数据库模型、认证、个人组织、成员/项目、流式 ZIP 接收、持久化 Job、独立 Artifact Worker、固定 Release Preview、Publish/Rollback 与正式访问均已进入 Rust 实现。
- 上传采用“创建预留 → 原始 Body 流式写入 → 完成入队”三步协议；数据库 transfer lease 与文件 `.part` 生命周期允许中断后重传，`/complete` 并发或重复调用不会重复创建 Release/Job。
- Worker 使用 `SKIP LOCKED`、heartbeat、lease sweep、指数退避和最大尝试次数实现可恢复执行；安全解压、稳定 Manifest、完整 SHA-256、不可变 Artifact 提交以及 ready/failed 状态收敛均已完成。
- 发布/回滚以 `project_active_releases` 为唯一事实源：Project 行锁串行化并发切换，Release 与 Artifact ready 状态在事务内加锁校验，活动指针、Deployment 和 Audit 原子提交；Release 保持不可变 ready 状态，不写 `current` 软链接。
- `Idempotency-Key` 以 Project 为作用域；相同键和相同命令重放原结果，相同键用于不同动作或目标会稳定冲突。回滚目标必须曾有成功部署记录，当前活动版本不能再次发布或回滚。
- Access Plane 使用独立监听地址与控制面隔离；固定预览 URL 绑定 Project Slug + Release UUID，正式 URL `/{project_slug}/` 每次从数据库活动指针解析不可变 Artifact，两类地址共享 Manifest 白名单、MIME、ETag、条件请求、Range、缓存策略和 HTML 导航 SPA fallback。
- PostgreSQL 事务测试覆盖注册时组织创建、角色隔离、项目审计、并发 Slug、原子项目设置更新、无变化更新降噪、上传重试、幂等入队、并发 Job、租约恢复、Artifact 状态收敛、固定/活动版本解析、并发发布、幂等重放、回滚资格、成员角色/移除并发更新、完整邀请状态机、密码恢复并发、API Token 并发与审计游标分页；Rust 全工作区现有 129 项常规测试，以及 16 项真实 PostgreSQL、2 项完整 HTTP E2E 和 1 项真实 SMTP 测试。
- 真实 E2E 已贯通注册 → 项目设置更新 → 两次 HTTP 上传 → PostgreSQL Job → Worker → 两个不可变 Artifact/ready Release → Release 历史 → 固定 Preview → 发布 A → 正式地址 A → 发布 B → 正式地址 B → 回滚 A → 项目审计查询，并验证固定 B Preview 不受活动指针切换影响。
- R2 的 Rust OpenAPI 快照、TypeScript Client 生成与一致性门禁、Cookie/CORS 浏览器传输策略、Release 历史、组织审计读取、当前用户资料更新、成员生命周期、邀请生命周期、密码恢复后端与可靠 SMTP Outbox，以及 Console 全 Store/认证恢复界面切换已经完成；未交付 Eden/Rust 双 Client 兼容运行模式。
- 非破坏性的项目设置更新已经开放：owner/admin 可在行锁事务内更新名称、Slug、描述、SPA fallback 与缓存策略，实际变化和审计日志原子提交。项目删除仍不开放，必须与活动版本下线、Artifact 保留策略和 GC 状态机一起交付；自定义域名走独立验证状态机，不混入项目 PATCH。

### 已完成切片：成员移除

目标是闭合组织成员生命周期，同时复用角色修改已经建立的组织级串行化边界：

1. 开放 `DELETE /_api/organizations/{organization_id}/members/{user_id}`，要求有效 Cookie Session 与 CSRF Header，成功返回 `204 No Content`。
2. 允许任何成员主动退出；唯一 owner 不得退出。管理其他成员时，owner 可以移除任意非最后 owner，admin 只能移除非 owner，其他角色不得移除他人。
3. PostgreSQL 事务必须先锁 organization，再读取 actor、target 与 owner 数量；删除 membership 和写入 `member.removed` 审计记录必须在同一事务提交，延续角色修改的统一锁顺序。
4. 不存在或已删除的 organization、非成员 actor 统一返回 `FORBIDDEN`；合法 actor 操作不存在的 target 返回 `MEMBER_NOT_FOUND`；破坏最后 owner 约束返回 `LAST_OWNER`。
5. 测试覆盖完整角色矩阵、主动退出、最后 owner、重复请求、角色修改与成员移除并发竞争、事务回滚、HTTP 鉴权/CSRF/路径参数，以及 OpenAPI 快照和 TypeScript Client 一致性。
6. 本切片不处理待接受邀请、用户账号删除、项目删除或 Artifact GC；这些状态机分别实现，避免把成员关系删除扩张为数据生命周期删除。

### 已完成切片：邀请生命周期

邀请不兼容旧 TypeScript 的“仅邀请已注册用户 + 非事务接受”模型，直接按最终状态机实现：

1. `invitations` 保存 `pending / accepted / revoked / expired` 状态、规范化邮箱、目标角色、邀请人、接受人、过期时间和解决时间；数据库约束保证状态与时间字段一致，并以部分唯一索引保证同一组织和邮箱最多只有一个 pending 邀请。
2. 邀请任意合法邮箱，不要求目标用户已经注册；接受者必须先登录，且当前账号的规范化邮箱必须与邀请邮箱完全一致。
3. 邀请令牌使用 32 字节操作系统随机数和 URL-safe Base64，只在创建响应中出现一次；数据库仅保存 SHA-256 摘要并校验 32 字节长度。管理列表、审计、日志和错误都不得泄露令牌。
4. 接受接口使用 `POST /_api/invitations/accept` 的 JSON Body 传递令牌，不把令牌放进 API 路径、查询参数或访问日志。相同用户重复接受成功结果可以安全重放，不重复写 membership 或审计。
5. 创建、撤销、接受都先锁 organization，再锁 invitation/membership；接受时 membership、邀请状态和 `member.joined` 审计必须在一个事务提交。过期状态也必须显式落库，不能只依赖运行时判断。
6. owner 可以邀请或撤销任意角色；admin 只能处理非 owner 邀请；其他角色不能查看或管理邀请。已有成员、活动邀请、错误收件人、过期和已撤销令牌分别返回稳定错误码。
7. API 提供组织范围的创建、活动列表、撤销和令牌接受。创建响应返回一次性 `acceptToken` 供当前阶段人工分享；邮件发送必须在后续以可靠 Outbox/Delivery 适配器实现，不能把明文令牌持久化到普通 Job 表冒充可靠邮件。
8. 验收覆盖并发重复创建、创建与接受竞争、撤销与接受竞争、过期后重新邀请、错误邮箱、同用户接受重放、数据库约束、CSRF、OpenAPI 快照和 TypeScript Client。

### 后端已完成切片：密码重置与可靠邮件交付

密码重置不沿用旧 TypeScript 的“写入令牌后同步尝试发信，再分两次更新密码与令牌”的实现。Rust 版按最终账号恢复模型交付，API、令牌状态、邮件投递与会话失效必须闭环：

1. `password_reset_requests` 保存 `pending / consumed / superseded / expired` 状态、用户、32 字节令牌摘要、申请时间、过期时间和解决时间；数据库约束保证状态与时间一致，并以部分唯一索引保证每个用户最多只有一个 pending 请求。令牌使用操作系统随机生成的 32 字节 URL-safe Base64，数据库、审计和日志永远只保存摘要。
2. `POST /_api/auth/password-resets` 是公开的匿名申请接口。除无效 JSON 外，合法请求结构无论邮箱格式、账号是否存在、账号是否禁用或是否命中冷却都统一返回 `202 Accepted`、空响应和 `Cache-Control: no-store`，不得返回令牌、用户信息或可区分错误。数据库按账号实施冷却与窗口限流，Control Plane 还必须按可信客户端地址实施独立的匿名接口限流。
3. 已存在且可用的账号在同一事务中锁定 user，显式过期旧请求、将仍 pending 的请求标记为 superseded，并创建新的重置请求与邮件 Outbox；未知、无效或禁用账号不创建重置记录。请求重放、并发申请以及申请与确认竞争都通过统一 user 行锁串行化。
4. 邮件 Outbox 是可靠交付边界，不把明文令牌放入通用 `jobs.input_json`。收件人、模板类型和包含令牌的投递参数使用应用层 AEAD 信封加密，表内只保存 key id、随机 nonce 和 ciphertext；密钥仅来自运行时 Secret 配置。轮换时保留旧解密 key，新的 Outbox 使用 active key，旧 key 只能在对应记录清空后移除。
5. Outbox 与重置请求原子创建，再由专用邮件 Worker 以 lease、heartbeat、指数退避和最大尝试次数投递 SMTP。Worker 处理前重新确认请求仍为 pending 且未过期；成功或永久失效后清空密文。生产环境缺少有效 Outbox key、公开 Console URL 或 SMTP 配置时必须启动失败，不能静默降级成日志打印令牌；开发环境使用 Mailpit 等本地 SMTP 捕获服务。
6. 邮件链接使用 `/reset-password#token=...`，令牌位于 URL Fragment，不进入 Web Server 请求行、反向代理访问日志或 Referer。Console 从 Fragment 读取后立即从地址栏移除，只通过 `POST /_api/auth/password-resets/confirm` 的 JSON Body 发送给 API。
7. 确认接口不要求 Cookie/CSRF，重置令牌本身是一次性授权凭证。服务先校验新密码策略并在事务外执行 Argon2，再按摘要定位用户、锁 user 后锁 reset request；所有不存在、格式错误、过期、superseded、consumed 或禁用账号统一返回 `INVALID_PASSWORD_RESET_TOKEN`，不暴露令牌状态。
8. 成功确认必须在一个 PostgreSQL 事务中更新密码哈希、将当前请求标记 consumed、supersede 该用户其他 pending 请求、撤销所有活动 `web_sessions` 和 `api_tokens`，并为用户仍加入的每个活动组织写入不含邮箱/令牌的 `user.password_reset_completed` 审计。相同令牌并发确认只能有一个成功，重放稳定失败。
9. 确认成功返回 `204 No Content` 并清除当前浏览器的 Session/CSRF Cookie；旧密码、所有旧 Cookie Session 和 API Token 随事务提交立即失效。后续登录只接受新密码，不自动创建新会话，避免账号恢复操作隐式登录错误浏览器环境。
10. 验收覆盖防枚举响应、账号/匿名限流、密文不可读与 AAD 防篡改、密钥轮换、SMTP 重试和永久失败、过期投递取消、申请/确认及双确认并发、事务回滚、旧凭证全部失效、审计脱敏、Fragment 链接、OpenAPI 快照和 TypeScript Client。

后端实现已完成上述数据库、领域服务、API、匿名地址限流、加密 Outbox、SMTP Worker、生产配置与契约验收。申请接口按客户端地址每十分钟最多处理五次，超限仍返回统一 `202`；确认接口每十分钟最多尝试十次，超限返回稳定的 `ANONYMOUS_RATE_LIMITED`。默认只采用 TCP 对端地址，只有显式列入 `ZIPSHIP_TRUSTED_PROXY_NETWORKS` 的代理才允许参与 `X-Forwarded-For` 解析。

### 已完成切片：Console 认证与密码恢复界面

1. Console 认证 Store 全面切换到 Rust OpenAPI Client 和 HttpOnly Cookie Session，删除旧 Bearer/`sessionStorage` 路径，不保留双客户端兼容分支。
2. 登录页增加“忘记密码”入口与统一成功提示；申请页不得根据邮箱、账号状态或限流结果展示差异信息。
3. `/reset-password` 首次加载从 URL Fragment 读取令牌后立即使用 `history.replaceState` 清除地址栏 Fragment；令牌只保存在页面内存，不进入持久化 Store、日志、分析事件或 URL 查询参数。
4. 确认表单在本地复用密码策略提示，通过匿名确认 API 提交；成功后跳转登录并提示所有旧会话已失效，不自动登录。
5. 覆盖无令牌、无效/过期令牌、弱密码、重复提交、网络失败、刷新丢失内存令牌、移动端布局、键盘操作和无障碍状态播报；完成 Console 单元测试、类型检查与浏览器 E2E。

实现已完成：Console 删除 `@zipship/api`/Eden、Bearer 和 `sessionStorage` 认证路径，所有 Store 使用 Rust 生成 Client、Cookie 与 CSRF；登录、注册、注销、资料、项目、成员、审计、上传、发布和回滚统一使用最终 Rust 路由。密码恢复页面实现 Fragment 凭证即时清理、同标签页新链接接管、统一防枚举文案和全会话撤销提示。Console 139 项测试、TypeScript、OpenAPI 漂移、Lint、Web 生产构建及桌面/390px 浏览器验收通过。

### 已完成切片：Console 邀请接受与管理闭环

1. 增加 `/invitations/accept#token=...` 页面，复用一次性 Fragment 内存凭证边界；凭证不得进入查询参数、持久化 Store、日志或分析事件。
2. 未登录收件人可以先完成登录/注册再回到邀请确认，不在 URL 中回传令牌；已登录但邮箱不匹配时展示稳定错误且不得泄露邀请目标邮箱。
3. Members 页面接入活动邀请列表与撤销操作，严格按 Rust owner/admin 权限和稳定错误码渲染，不重新引入旧“仅邀请已注册用户”逻辑。
4. 覆盖缺失/过期/撤销/错误邮箱/安全重放、登录往返、CSRF、移动端、键盘和浏览器控制台；保持生成 Client 漂移、类型、Lint、单测和生产构建全绿。

实现已完成：`/invitations/accept` 只消费 URL Fragment 中的一次性凭证，进入页面后立即清除地址栏和历史记录，并只在当前文档内存中保存；误放到查询参数的 token 不会被接受且会被立即移除。未登录用户通过固定、无凭证的内存 continuation 完成登录或注册往返；错误账号只展示稳定隐私提示，不显示目标邮箱；成功与安全重放共用完成态。Members 页面已接入活动邀请列表、一次性人工分享链接、撤销、角色边界、加载/空/错误状态和无原生 `confirm` 的可访问确认对话框。组织切换使用请求序列隔离，旧组织响应不会覆盖当前成员或邀请。Web/Desktop Shell 使用固定 `ZipShip` 标题，避免初始含 Fragment 的 URL 被浏览器临时作为标签标题；中英文设置同步更新 `<html lang>`。Console 155 项测试、TypeScript、OpenAPI 漂移、Lint、Web 生产构建及桌面/390px 浏览器验收通过，浏览器控制台 0 warning/error；主包约 955 KB 的拆包警告继续作为独立性能问题处理。

### 已完成切片：个人 API Token 领域与管理闭环

1. Rust 新建独立 API Token 领域服务与 PostgreSQL 仓储，不复用 Cookie Session：令牌仅创建时返回一次，数据库只保存摘要，名称、scope、过期、最后使用、撤销和账号停用边界均显式建模。
2. Control Plane 增加本人 Token 的创建、活动列表和撤销接口；创建/撤销要求 Cookie Session + CSRF，Bearer Token 只用于受 scope 约束的 API 认证，不得访问 Console 会话接口或扩大当前用户权限。
3. Console 增加安全设置入口；创建后的明文 Token 只保存在当前对话框内存并支持一次复制，关闭后不可恢复；列表只显示名称、前缀、scope、创建/过期/最后使用时间和状态，撤销使用可访问确认对话框。
4. 覆盖明文不落库/日志、摘要校验、并发撤销与认证、scope 最小权限、过期/停用、CSRF、OpenAPI、移动端、键盘和浏览器控制台，并保持无旧 TypeScript 兼容分支。

领域切片已完成：新建独立 `zipship-tokens` crate，以 `zps_` 前缀加 32 字节操作系统随机数生成凭证，明文仅通过 `SecretString` 的创建结果交付，持久化命令只含 SHA-256 摘要和用于识别的短前缀，所有 `Debug` 路径显式脱敏。Token 名称、四个稳定 scope、1–365 天强制过期、每用户最多 20 个活动 Token、撤销/过期/账号停用以及稳定错误码已建模。Bearer 解析先在仓储访问前校验格式，认证结果只携带 Token 原有 scope，后续 HTTP 权限层必须再与用户组织 RBAC 取交集，不得因 Token 扩权。

PostgreSQL 仓储切片的目标是：直接建立最终 schema 约束和索引，用用户行锁串行化活动 Token 上限与账号状态；创建、列表、幂等撤销、摘要解析与 `last_used_at` 更新都在真实 PostgreSQL 事务测试中验证，并覆盖并发创建、撤销/认证竞争和已停用账号。

PostgreSQL 切片已完成：无兼容性地替换临时 `api_tokens` 表，数据库强制名称、`zps_` 短前缀、32 字节摘要、scope 集合、1–365 天过期窗口与时间顺序；用户行锁确保并发创建不能突破 20 个活动 Token，撤销和认证按 Token 行串行化。撤销对重放幂等，仅首次变化写入不含凭证数据的组织审计；`last_used_at` 最多每五分钟落库一次。普通撤销与密码重置批量撤销均对多节点时钟偏移保持单调，不会因领先的最后使用时间而撤销失败。管理列表活动项优先并限制最近 100 项，避免无界查询。

Control Plane HTTP 与鉴权切片已完成：

1. 新增 `POST/GET /_api/api-tokens` 与 `DELETE /_api/api-tokens/{token_id}`。管理接口只接受当前用户的 Cookie Session；创建和撤销强制 CSRF，撤销可安全重放。明文只出现在创建响应，所有响应使用 `Cache-Control: no-store`，列表只返回短前缀和安全元数据。
2. Bearer 仅接入显式资源路由：项目读取要求 `projects:read`，版本读取要求 `releases:read`，上传全流程要求 `uploads:write`，发布、回滚与部署历史要求 `deployments:write`。项目创建/修改、组织安全设置、Cookie Session、CSRF 与 Token 管理本身不接受 Bearer。
3. 资源路由只要出现 `Authorization` Header 就优先解析 Bearer；格式错误、摘要不存在、已过期、已撤销、账号停用或 scope 不足都不得回退到同时存在的 Cookie Session。Bearer 请求不检查 CSRF，Cookie 写请求继续强制 CSRF。
4. scope 只完成第一层最小权限校验。Token 解析出的 `user_id` 仍进入现有项目、版本、上传和部署服务，仓储按数据库中的当前 membership/role 再次授权；因此最终权限始终是 Token scope 与实时组织 RBAC 的交集，角色下降或成员移除无需重新签发 Token 即刻生效。
5. OpenAPI 同时声明 `cookieAuth` 与 `apiToken` 安全方案，支持 Bearer 的操作使用 OR security requirement，Cookie 专属接口保持单一安全方案；CORS 明确允许 `Authorization`。Rust 快照和 TypeScript Client 已重新生成并通过漂移检查。
6. 验收覆盖一次性密钥、摘要不出响应、CSRF、Bearer 禁止管理 Token、scope 拒绝、Authorization 优先级、跨用户项目不可见、幂等撤销和撤销后立即失效。真实 PostgreSQL 测试继续覆盖摘要、活动上限、最后使用节流、账号停用和并发竞争；完整 HTTP E2E 已增加 Cookie 创建 Token → Bearer 读取 → Cookie 撤销 → Bearer 失效链路。

### 已完成切片：Console API Token 安全设置

1. Console 直接接入 Rust 生成 Client，不保留 Eden 或旧 TypeScript API 兼容分支；安全设置中的列表、创建和撤销都使用最终 `/_api/api-tokens` 契约、Cookie Session 与 CSRF。
2. 创建表单要求名称、1–365 天内的预设有效期和至少一个显式 scope；一次性明文 Token 只存在于创建对话框子组件的本地内存，不进入 Zustand、Storage、URL、Toast、日志或错误对象。
3. 创建完成后只提供一次查看、全选和复制；完成、取消、关闭设置、按 Escape 或组件卸载都会销毁明文状态，重新打开无法恢复。列表始终只展示名称、短前缀、scope、创建/过期/最后使用时间和活动、过期、已撤销状态。
4. 撤销使用可访问确认对话框并调用真实 Rust API；加载骨架、空状态、稳定错误码、重试、重复请求隔离、焦点环和屏幕阅读器标签均已覆盖，中英文、日间/夜间和窄屏布局使用同一信息架构。
5. Console 新增 10 项针对 Client、安全内存边界、创建校验、复制、撤销、错误重试和设置导航的测试，当前 38 个测试文件共 165 项通过；11 个工作区类型检查、Lint、Web/Desktop 生产构建和 OpenAPI 生成契约均保持通过。
6. 真实浏览器验收覆盖桌面与 390px、中英文、日间/夜间、真实创建/复制/清除/撤销、Escape 与设置关闭重开；浏览器控制台 0 warning/error，且明文在关闭后从 DOM 完全消失。主包约 976 KB 的拆包警告继续作为独立性能问题处理。

### 已完成切片：旧 TypeScript 后端完整退场

1. 删除 `apps/api`、Drizzle `packages/db`、旧 `config/deploy-core/storage/shared` 服务端包、第一阶段 unit/integration/e2e/Nginx 测试、Drizzle 脚本与 migrations、Elysia Dockerfile、动态 Nginx 配置和过期 TODO；不保留兼容路由、双数据库、旧 Client 或运行时 fallback。
2. 根 Bun 工作区收敛为 Web Shell、Desktop Shell、Console、生成 API Client 和 Runtime 五个包；移除 Elysia、Eden、Drizzle、Playwright、`pg`、`yauzl`、Nodemailer 等旧后端直接依赖并重建锁文件，根 `bun run build` 不再被 `chromium-bidi` 阻塞。
3. 新增 `cutover:check` 永久门禁：阻止旧目录和依赖重新进入仓库，同时验证 Rust OpenAPI 的 23 个关键操作以及 API/PostgreSQL/Storage/Artifact/Server/Worker/Migrations 七个运行边界仍存在。CI 在契约、Lint、根/工作区类型、Console 测试和生产构建前执行该门禁。
4. Console Access Plane 配置从 Control Plane 中彻底分离：Web/Desktop Shell 同时注入 API 与 Access Origin；固定预览统一使用 `/_sites/{project_slug}/{release_id}/`，正式访问使用 `/{project_slug}/`，不再根据 Console 当前 Origin 或旧 release hash 拼接地址。
5. `infra/docker/docker-compose.yml` 只保留本地 PostgreSQL 与 Mailpit，并明确不冒充生产栈；旧 Elysia 镜像和软链接 Nginx Access Plane 已删除。本机忽略的第一阶段 Artifact 仅作为未跟踪数据保留，不参与任何 workspace、运行时或测试路径。
6. 验收通过：Console 38 个文件共 166 项测试、根与五个工作区 TypeScript、Lint、OpenAPI 漂移、冻结安装、Web/Desktop 生产构建、Rust fmt/Clippy 和 129 项常规测试全部通过；独立数据库中 15 项 PostgreSQL 仓储测试、1 项真实 SMTP 和 2 项完整 HTTP/Worker 流程通过并完成清理。
7. 主前端包约 975 KB 的拆包警告仍是独立性能问题。下一个优先切片是最终 Rust 生产发行：构建非 root、多阶段、锁定依赖的 `zipshipd`/Worker/Console 镜像，建立迁移顺序、健康检查、持久卷、TLS/反向代理拓扑，并在干净环境执行可重复的 Compose smoke test。

### 已完成切片：最终 Rust 生产发行

1. `Dockerfile.server` 使用锁定的 Rust 1.97 多阶段构建，同一次 release 构建产出 `zipshipd` 与 `zipship-worker`；运行时只保留 CA/curl 与两个 binary，并固定 UID/GID 10001。迁移、Server 和 Worker 引用同一不可变镜像，不再构建或携带旧 TypeScript 后端。
2. `Dockerfile.edge` 在锁定 Bun 1.3.14 和冻结 lockfile 下构建 Web Console，再复制到锁定 Caddy Alpine 运行时。Edge 使用官方 `caddy` 非 root 用户和内部 8080/8443 高端口，drop all capabilities，不通过 root/setcap 绑定特权端口。
3. Caddy 只承担平台 Console/API/Access 三个 Origin 的自动 HTTPS、静态压缩缓存、安全响应头和反向代理。项目固定预览、活动版本解析、Manifest、SPA fallback 和缓存业务策略仍完全由 Rust Access Plane 决定，不恢复 Nginx 动态项目配置或软链接事实源。
4. `compose.production.yml` 把 PostgreSQL 放在 internal backend 网络且不暴露宿主端口；一次性 migration 成功后才启动 Server/Worker，二者健康后才启动 Edge。PostgreSQL、Artifact、Caddy certificate/config 各自使用持久卷；只有 Worker/Edge 接入出网网络。
5. 应用与 Edge 使用只读根文件系统、临时 `/tmp`、`no-new-privileges`、capability 全删除和 PID 上限。生产必需配置通过 Compose required substitution 与 Rust production validation 双重拒绝缺失值；生产栈不包含 Mailpit。
6. `scripts/smoke-production.ts` 使用随机项目名、端口、子网、数据库密码、Outbox Key 与临时卷，通过 Caddy 内部 CA 的真实 HTTPS 执行注册、组织、项目、ZIP 流式上传、Worker 处理、ready Release、发布、固定预览和正式访问，并在任何结果下清理自己的 Compose 卷。
7. CI 新增独立 `production-smoke` 门禁，在 Rust 与 Frontend 任务成功后从空 Docker 环境构建最终两只镜像并执行上述发布链路；本地开发 Compose 继续只提供 PostgreSQL/Mailpit，不能代替生产栈。
8. 平台三域 TLS 与可重复发行物已经进入 R3；用户自定义域名验证/证书状态机、Artifact 保留/GC、指标告警、PostgreSQL/Artifact 备份恢复演练和 Console 首包拆分仍是后续独立问题。
9. 本轮 Windows 本机的完整生产 smoke 未能进入容器启动阶段：Docker Hub 拉取官方 Bun/Caddy/Rust 基础镜像多次出现 `unexpected EOF`，共享 BuildKit 长时间停留在 0 个 Dockerfile 步骤，最终 Docker Desktop 报告无法启动。测试未创建业务容器/卷，PostgreSQL 17.6 镜像已完整落地；冻结安装、Compose 合并配置、OpenAPI、切换门禁、Lint、TypeScript、Console 166 项测试、Web/Desktop 构建、Rust fmt/check/Clippy 和 129 项常规测试均通过。最终生产链路必须在 Docker 引擎恢复后本机重跑或由新增 CI 门禁成功执行，不能把本次外部阻塞记作 smoke 通过。
