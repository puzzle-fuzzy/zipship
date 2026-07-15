# ZipShip

ZipShip 是面向静态前端产物的自托管发布平台。用户上传已经构建好的 ZIP，系统负责流式接收、安全解压、不可变版本、固定预览、正式发布、回滚、成员权限和审计。

当前 `rust-dev` 分支采用完整 Rust 后端，不兼容第一阶段 Elysia API、Drizzle schema、软链接发布模型或旧数据。React Console 与 Tauri 薄壳保留，通过 Rust OpenAPI 生成的 TypeScript Client 调用最终接口。

## 当前架构

```txt
apps/web-shell             Vite Web 入口
apps/desktop-shell         Tauri 桌面入口
packages/console-app       Web/Desktop 共用 React Console
packages/api-client        Rust OpenAPI 快照与生成 Client
packages/runtime           Web/Desktop 能力适配边界
crates/zipship-*           Rust 领域、HTTP、SQLx、存储、任务与邮件模块
services/zipshipd          Control Plane + 独立 Origin Access Plane
services/zipship-worker    Artifact 与邮件后台 Worker
```

核心事实边界：

- PostgreSQL 保存账号、组织、权限、上传、任务、不可变版本、活动版本指针、部署和审计。
- Artifact 存储只保存 staging 与内容寻址的不可变文件；发布和回滚不写 `current` 软链接。
- `zipshipd` 分别监听 Control Plane 与 Access Plane；正式访问每次依据数据库活动指针解析 Artifact。
- Worker 使用数据库 lease、heartbeat、重试和终态收敛处理 ZIP 与可靠邮件 Outbox。
- Console 只使用生成 Client、HttpOnly Cookie Session、CSRF 和受 scope 限制的 API Token。

## 本地启动

需要 Bun 1.3、Rust 1.94、Docker 与 PostgreSQL 17。

```bash
cp .env.example .env
bun install
bun run infra:up
bun run db:migrate
bun run dev
```

`bun run dev` 并行启动：

- Rust Control Plane：`http://127.0.0.1:5006`
- Rust Access Plane：`http://127.0.0.1:5007`
- Web Console：`http://127.0.0.1:4015`
- Artifact/Mail Worker

也可以分别运行 `bun run dev:api`、`bun run dev:worker` 和 `bun run dev:web`。桌面开发使用 `bun run desktop:dev`。

健康与契约端点：

- `GET /_health/live`
- `GET /_health/ready`
- `GET /_api/openapi.json`

## 质量门

```bash
# Rust 最终架构和旧后端退场门禁
bun run cutover:check

# OpenAPI / Frontend
bun run api:check
bun run lint
bun run typecheck:workspaces
bun run test
bun run build

# Rust
bun run rust:fmt
bun run rust:check
bun run rust:clippy
bun run rust:test
```

真实 PostgreSQL、SMTP 与完整 HTTP/Worker 测试由 CI 在隔离服务中串行执行。`bun run test:all` 可运行 Console 与常规 Rust 测试；带 `#[ignore]` 的外部服务测试仍要求专用测试数据库，不能直接指向开发库。

## 基础设施状态

`infra/docker/docker-compose.yml` 只提供本地 PostgreSQL 和 Mailpit，不冒充生产发行栈。旧 Elysia 镜像和基于软链接的 Nginx Access Plane 已删除。最终生产镜像、Console 静态托管、TLS/反向代理和从空环境启动 smoke test 将在独立部署切片中完成。

## 文档

- [产品设计](docs/01-产品设计.md)
- [Rust 第二阶段重构方案与实施记录](docs/06-Rust-第二阶段重构方案.md)
- [第一阶段问题基线与关闭记录](docs/05-当前状态与问题清单.md)

`docs/02-技术架构.md`、`docs/03-测试规范与实施路线.md` 和 `docs/superpowers/` 保存第一阶段历史决策，只用于追溯，不再是当前实现规范。
