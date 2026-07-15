# AGENTS.md

用 Python 脚本读取或检查包含中文的文件，避免 PowerShell 编码问题。

## Project

ZipShip 是自托管静态产物发布平台：接收已经构建好的 ZIP，安全展开为不可变 Artifact，提供固定预览，并通过 PostgreSQL 活动版本指针完成原子发布和回滚。

当前后端是最终 Rust 架构。不要重新引入 Elysia、Eden、Drizzle、旧 TypeScript deploy/storage 包、Nginx 动态项目配置、软链接发布或双 Client 兼容分支。`bun run cutover:check` 会验证这条边界。

## Commands

```bash
# Local infrastructure and migrations
bun run infra:up
bun run infra:down
bun run db:migrate

# Development: API + Access Plane + Worker + Web Console
bun run dev
bun run dev:api
bun run dev:worker
bun run dev:web
bun run desktop:dev

# Frontend and contract
bun run cutover:check
bun run api:generate
bun run api:check
bun run smoke:production
bun run lint
bun run typecheck:workspaces
bun run test
bun run build

# Rust
bun run rust:fmt
bun run rust:check
bun run rust:clippy
bun run rust:test
bun run test:integration
```

`bun run test:all` 运行 Console 与常规 Rust 测试。`bun run test:integration` 使用随机端口启动临时 PostgreSQL/Mailpit，运行全部带 `#[ignore]` 的真实仓储、SMTP 和 HTTP/Worker 流水线测试，并自动删除临时数据；禁止把 `ZIPSHIP_TEST_DATABASE_URL` 指向开发库。CI 也会显式运行这些测试。

`bun run smoke:production` 构建最终非 root Server/Worker 与 Console/Caddy 镜像，并在随机隔离的 HTTPS Compose 环境执行真实上传发布链路。生产编排位于 `infra/docker/compose.production.yml`；`infra/docker/docker-compose.yml` 仅用于本地依赖，不得向其中加入生产服务。

## Workspace

```txt
apps/web-shell             Web Vite entry
apps/desktop-shell         Tauri entry
packages/console-app       Shared React Console
packages/api-client        Rust OpenAPI snapshot + generated TypeScript Client
packages/runtime           Web/Desktop capability adapter
crates/zipship-api         Axum Control Plane HTTP boundary
crates/zipship-access      Independent-Origin Access Plane
crates/zipship-postgres    SQLx repositories and embedded migrations
crates/zipship-storage     Artifact storage boundary
crates/zipship-artifact    Safe ZIP extraction and immutable manifest pipeline
crates/zipship-*           Domain services for auth/projects/uploads/etc.
services/zipshipd          Control + Access server binary
services/zipship-worker    Artifact and mail worker binary
```

## Backend architecture

- Domain crates own invariants, commands, repository traits and stable errors. They do not depend on Axum or SQLx.
- `zipship-domain` groups organization, project, upload, job, release, artifact and permission values/state machines by module; `lib.rs` is the stable re-export facade and must not become a new aggregate implementation file.
- `zipship-postgres` implements repository traits. Transactions and row-lock ordering live here; schema migrations are embedded from `crates/zipship-postgres/migrations`.
- `zipship-api` maps HTTP DTOs/authentication to domain services. Responses return stable `code` values, never localized user-facing messages.
- `zipship-api` route-contract tests live under `src/tests/`, grouped by feature; shared in-memory boundary fixtures stay in `src/tests/mod.rs` instead of the production assembly module.
- `zipshipd migrate` is the only migration entry. `zipshipd serve` starts Control and Access listeners and does not silently mutate schema.
- Cookie Sessions are HttpOnly and stateful; browser writes require CSRF. API Tokens are separate credentials with explicit scopes, and effective permission is scope intersected with current organization RBAC.
- Upload content is streamed to staging with an exact byte reservation. Completion creates a persistent job; it does not synchronously unzip in the request.
- Worker claims jobs with lease/heartbeat/retry, safely extracts ZIPs, builds a stable manifest and commits content-addressed immutable Artifacts.
- `zipship-artifact` keeps public models, job repository ports, stable errors, ZIP validation/extraction and manifest construction in separate modules; `lib.rs` only re-exports the supported surface.
- Artifact ZIP preflight must inspect raw central-directory entries before trusting `ZipArchive`: the upstream reader indexes by raw filename and otherwise collapses exact duplicates, which can also hide the true entry count.
- Release is immutable. Publish/rollback atomically updates the database activity pointer with deployment and audit records; filesystem symlinks are not a source of truth.
- Access Plane serves only ready Artifact files present in the manifest. Fixed preview and live paths share MIME, ETag, Range, cache and HTML-navigation SPA fallback rules.
- `zipship-access` keeps manifest/path invariants, repository ports, HTTP policy and Axum file serving in separate modules; `lib.rs` is the stable public facade.
- Password recovery and invitations use one-time secrets. Database, audit and logs store only digests or encrypted Outbox envelopes.

## API contract

Rust `utoipa` output is the source of truth:

1. `cargo run -p zipship-api --bin zipship-openapi` emits the snapshot.
2. `scripts/generate-api-client.ts` generates `packages/api-client/src/generated/schema.ts`.
3. `bun run api:check` must detect any drift.
4. Console imports only `@zipship/api-client`; do not hand-write a parallel server contract.

## Frontend

- `packages/console-app` is shared by Web and Tauri.
- State uses Zustand only for durable UI/session metadata. One-time secrets must remain in the smallest component-local memory boundary and be destroyed on close/unmount.
- API calls use the generated OpenAPI Client, Cookie Session and CSRF helpers in `src/api`.
- Stable Rust error codes are mapped to English/Chinese copy in Console; backend errors do not contain presentation strings.
- Theme uses the existing `day`/`night` settings and Tailwind CSS v4 tokens. Preserve keyboard access, focus indicators, responsive layouts and both locales.
- Access URLs follow Rust routing: fixed preview is `/_sites/{project_slug}/{release_id}/`; live is `/{project_slug}/` on the Access Plane origin.

## Testing

- Rust unit tests live beside crate code; real repository tests live under `crates/zipship-postgres/tests`.
- Full upload/publish/recovery HTTP pipelines live in `services/zipship-worker/tests/artifact_pipeline.rs`.
- External-service Rust tests are ignored by default and require `ZIPSHIP_TEST_DATABASE_URL` or `ZIPSHIP_TEST_SMTP_URL`.
- Run external-service tests locally through `bun run test:integration`; its project-scoped ephemeral Compose stack is the only safe default because repository tests truncate tables.
- Console uses Vitest + Testing Library under `packages/console-app/tests`.
- Route/auth tests must verify stable error shape, CSRF, credential priority, scope + RBAC intersection and secret non-disclosure.
- Filesystem tests use temporary storage and guaranteed cleanup; never point tests at `.zipship` development data.

## Working rules

- Use `rg` / `rg --files` for discovery.
- Preserve unrelated user changes and ignored local Artifact data.
- Each independently completed issue gets its own commit on `rust-dev`.
- Run checks proportional to risk; changes to workspace/dependencies require `bun install`, cutover/API checks, tests, typecheck, lint and production builds.
- Do not claim production readiness from `infra/docker/docker-compose.yml`; it intentionally contains only PostgreSQL and Mailpit until the production deployment slice is delivered.
