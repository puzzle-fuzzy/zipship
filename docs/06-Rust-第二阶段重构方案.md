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

- 第 1～8 项已完成，R1 最小 Rust 纵向切片闭环：Workspace 与基础设施、全新数据库模型、认证、个人组织、成员/项目、流式 ZIP 接收、持久化 Job、独立 Artifact Worker、固定 Release Preview、Publish/Rollback 与正式访问均已进入 Rust 实现。
- 上传采用“创建预留 → 原始 Body 流式写入 → 完成入队”三步协议；数据库 transfer lease 与文件 `.part` 生命周期允许中断后重传，`/complete` 并发或重复调用不会重复创建 Release/Job。
- Worker 使用 `SKIP LOCKED`、heartbeat、lease sweep、指数退避和最大尝试次数实现可恢复执行；安全解压、稳定 Manifest、完整 SHA-256、不可变 Artifact 提交以及 ready/failed 状态收敛均已完成。
- 发布/回滚以 `project_active_releases` 为唯一事实源：Project 行锁串行化并发切换，Release 与 Artifact ready 状态在事务内加锁校验，活动指针、Deployment 和 Audit 原子提交；Release 保持不可变 ready 状态，不写 `current` 软链接。
- `Idempotency-Key` 以 Project 为作用域；相同键和相同命令重放原结果，相同键用于不同动作或目标会稳定冲突。回滚目标必须曾有成功部署记录，当前活动版本不能再次发布或回滚。
- Access Plane 使用独立监听地址与控制面隔离；固定预览 URL 绑定 Project Slug + Release UUID，正式 URL `/{project_slug}/` 每次从数据库活动指针解析不可变 Artifact，两类地址共享 Manifest 白名单、MIME、ETag、条件请求、Range、缓存策略和 HTML 导航 SPA fallback。
- PostgreSQL 事务测试覆盖注册时组织创建、角色隔离、项目审计、并发 Slug、原子项目设置更新、无变化更新降噪、上传重试、幂等入队、并发 Job、租约恢复、Artifact 状态收敛、固定/活动版本解析、并发发布、幂等重放、回滚资格、成员角色/移除并发更新、完整邀请状态机、密码恢复并发与审计游标分页；Rust 全工作区现有 116 项常规测试，以及 14 项真实 PostgreSQL、2 项完整 HTTP E2E 和 1 项真实 SMTP 测试。
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

### 下一实施切片：Console 邀请接受与管理闭环

1. 增加 `/invitations/accept#token=...` 页面，复用一次性 Fragment 内存凭证边界；凭证不得进入查询参数、持久化 Store、日志或分析事件。
2. 未登录收件人可以先完成登录/注册再回到邀请确认，不在 URL 中回传令牌；已登录但邮箱不匹配时展示稳定错误且不得泄露邀请目标邮箱。
3. Members 页面接入活动邀请列表与撤销操作，严格按 Rust owner/admin 权限和稳定错误码渲染，不重新引入旧“仅邀请已注册用户”逻辑。
4. 覆盖缺失/过期/撤销/错误邮箱/安全重放、登录往返、CSRF、移动端、键盘和浏览器控制台；保持生成 Client 漂移、类型、Lint、单测和生产构建全绿。
