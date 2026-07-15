# ZipShip

ZipShip 是一个面向静态产物的私有化部署工具。第一阶段聚焦上传产物、检测、生成测试地址、发布正式版本和回滚。

`rust-dev` 正在进行第二阶段完整 Rust 重构。目标后端为 Axum + Tokio + SQLx/PostgreSQL；不兼容旧 Elysia API、旧数据库结构或软链接发布模型。现有 React Console 保留，并将在 Rust API 完备后切换到 OpenAPI 生成的 Client。

## 文档

- [产品设计](docs/01-产品设计.md)
- [技术架构](docs/02-技术架构.md)
- [测试规范与实施路线](docs/03-测试规范与实施路线.md)

## Workspace

```txt
apps/api              Bun + Elysia API
apps/web-shell        Web 控制台外壳
apps/desktop-shell    Tauri 桌面外壳
packages/console-app  Web / Desktop 共用 React 页面
packages/db           Drizzle schema / migrations
packages/deploy-core  产物检测、hash、发布、回滚核心逻辑
packages/storage      文件系统与未来对象存储抽象
services/zipshipd     Rust 控制面与访问平面
crates/zipship-*      Rust 领域、配置、数据库、任务、存储与 HTTP 边界
```

## Rust 第二阶段开发

```bash
# 复制并按需修改配置
cp .env.example .env

# 启动开发 PostgreSQL
bun run db:up

# 应用全新的 SQLx migrations
bun run rust:migrate

# 启动 Rust API / Access Plane
bun run rust:dev

# Rust 质量门
bun run rust:fmt
bun run rust:check
bun run rust:clippy
bun run rust:test
```

健康检查：

- `GET /_health/live`：进程存活，不依赖外部服务。
- `GET /_health/ready`：检查 PostgreSQL schema 与 Artifact 存储。
- `GET /_api/openapi.json`：当前 Rust API 契约。

当前 Rust 纵向切片已经贯通注册、个人组织、项目和上传入队。上传协议为：

- `POST /_api/projects/{project_id}/uploads`：预留 ZIP 文件名与精确字节数。
- `PUT /_api/uploads/{upload_id}/content`：携带 Cookie、CSRF、`Content-Length`，以原始 Body 流式写入 staging。
- `POST /_api/uploads/{upload_id}/complete`：幂等创建 processing Release 与持久化 Artifact Job，返回 `202`。
- `GET /_api/uploads/{upload_id}`：查询当前上传状态。

Artifact Worker 尚在下一阶段；当前 `processing` Job 已可靠持久化，但不会自动变为 ready Release。

## 开发端口

- Rust API：`http://127.0.0.1:5006`
- Web Shell：`http://127.0.0.1:4015`
- Desktop Shell renderer：`http://localhost:1420`（Tauri 约定端口；完整桌面开发用 `bun --filter @zipship/desktop-shell tauri dev`，需 Rust 工具链）

`dev:api`、`dev:web`、`dev:desktop` 都会在启动前清理对应端口；Web 与 Desktop 的 Vite 配置使用 `strictPort`，端口被占用时不会自动漂移。

## 配置

环境变量统一从仓库根目录 `.env` 读取，模板见 `.env.example`。前端只使用 `VITE_` 前缀变量；数据库、存储路径和服务端密钥只给后端与脚本读取。

Drizzle 配置位于 `packages/db/drizzle.config.ts`，根目录的 `db:generate`、`db:migrate` 脚本会显式指向这个配置文件。
