# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ZipShip is a self-hosted static artifact deployment tool — think lightweight Netlify/Vercel self-hosted. Users upload built static assets (zip), the platform detects, versions, serves test URLs, publishes releases, and supports rollback. The first phase focuses on the core loop: upload → detect → test URL → publish → rollback.

## Commands

```bash
# Development (each kills its port before starting)
bun run dev:api        # API server on http://localhost:3001
bun run dev:web        # Web shell on http://127.0.0.1:5173
bun run dev:desktop    # Electron shell on http://127.0.0.1:5174

# Testing
bun test               # Run all tests
bun test path/to/file  # Run a single test file
bun test -- --grep "pattern"  # Filter tests by name

# Type checking
bun run typecheck      # Typecheck root + all workspace packages

# Database (requires PostgreSQL running)
bun run db:generate    # Generate Drizzle migrations
bun run db:migrate     # Apply Drizzle migrations
```

Environment variables are read from `.env` at the repo root. Copy `.env.example` to `.env` before first run. Frontend only sees `VITE_`-prefixed variables; `DATABASE_URL`, `ZIPSHIP_STORAGE_ROOT`, and secrets are server/script only.

## Architecture

### Monorepo Structure (Bun Workspaces + Bun Catalogs)

```
apps/api              Bun + Elysia backend (control plane)
apps/web-shell        Vite + React web entry (thin shell, injects WebRuntime)
apps/desktop-shell    Electron entry (thin shell, injects ElectronRuntime)
packages/console-app  Shared React UI — both web and desktop render this
packages/db           Drizzle ORM schema + migrations (PostgreSQL)
packages/deploy-core  Core logic: unzip, detect, hash, manifest, publish, rollback
packages/storage      File system abstraction (local now, S3/MinIO later)
packages/api-client   Eden Treaty client — type-safe API calls
packages/runtime      RuntimeAdapter interface (web vs desktop capabilities)
packages/shared       Shared types, constants, reserved slugs
packages/config       Env and path configuration
```

Dependency versions live in root `package.json` `catalog` field; sub-packages reference them via `"catalog:"`. Cross-package deps use `"workspace:*"`.

### Control Plane vs Access Plane

- **Elysia** = control plane (API, auth, management). Does NOT serve production static assets.
- **Nginx** = access plane (serves user artifacts, SPA fallback, tail-slash redirects, Cache-Control headers).
- **PostgreSQL** = metadata (users, projects, releases, audit logs) — schema defined but **not yet wired**; all API data currently lives in-memory.
- **File system** = artifact storage (zips, extracted sites, symlinked `current`).

Nginx config template: [infra/nginx/zipship.conf](infra/nginx/zipship.conf). Routes: `/_api/` → Elysia, `/_console/` → management UI, `/:slug/` → current release, `/:slug/:hash/` → specific release.

### API Module Convention (Elysia Feature-Based)

Each business domain in `apps/api/src/modules/:feature/` follows this pattern:

- `index.ts` — Elysia plugin (controller). Exports a named plugin function that receives dependencies.
- `model.ts` — TypeBox validation schemas, derived types, and module-specific error classes.
- `service.ts` — Business logic class. Receives dependencies (repository interface, hash functions, clock) via constructor. Never touches HTTP context.
- `repository.ts` — Data access interface (defined in `service.ts` per-module); the single in-memory implementation lives in `auth/repository.ts`.

**Error handling rule**: Services return success results OR module error objects (e.g., `AuthServiceError`). Controllers map error objects to HTTP status codes using `status(code, payload)`. API error responses contain only stable `code` strings (e.g., `"DUPLICATE_EMAIL"`), never user-facing text. The frontend handles i18n by mapping error codes to Chinese/English.

**Type safety**: `apps/api` exports `type App = typeof app`. `packages/api-client` uses `@elysia/eden`'s `treaty<App>()` for end-to-end type-safe API calls.

**Current state — in-memory repositories**: All CRUD data is stored in `Map`s and lost on restart. The repository interfaces are cleanly segregated per module, so switching to PostgreSQL means writing separate Drizzle repository classes that implement those interfaces and replacing the single `createInMemoryAuthRepository()` call in `apps/api/src/index.ts`.

### Implemented API Modules

| Module | Routes | Notes |
|--------|--------|-------|
| auth | `POST /register`, `POST /login`, `GET /me` | Email normalization, session + refresh token |
| organizations | `GET /` | List user's orgs |
| projects | `POST /`, `GET /`, `GET /:id` | Slug validation, slug uniqueness |
| releases | `GET /` | List project releases |
| deployments | `POST /publish`, `POST /rollback`, `GET /deployments` | Writes filesystem artifacts |
| uploads | `POST /`, `PUT /raw`, `GET /:id`, `POST /complete` | Create → upload → process → complete lifecycle |
| site-preview | `GET /`, `GET /*` | Internal preview at `/_sites/:slug/:hash/` |
| permissions | internal service | RBAC owner/admin/developer/deployer/viewer |
| audit | internal service | Logs operations |
| release-processing | internal service | Orchestrates unzip → detect → manifest |

### Database (Drizzle ORM)

Schema is in [packages/db/src/schema.ts](packages/db/src/schema.ts). Core tables: `users`, `organizations`, `members`, `invitations`, `projects`, `releases`, `deployments`, `upload_tasks`, `audit_logs`, `sessions`, `desktop_devices`, `desktop_login_requests`, `desktop_login_tickets`. Two migrations exist (initial schema + slug uniqueness change).

Drizzle config is at [packages/db/drizzle.config.ts](packages/db/drizzle.config.ts); root `db:*` scripts explicitly point to it via `--config`.

### Release Model

- **Release** = immutable artifact version. Created after upload + unzip + detect + hash. Statuses: `uploading → processing → ready → active | failed | archived | deleted`.
- **Deployment** = the action of publishing/rolling back. Links a release to the `current` position.
- **current** = symlink `sites/:slug/current → releases/:hash`. Publishing = atomically relinking this symlink via `symlink → rename` for zero-downtime deploys.
- `release_hash` is derived from content (manifest hash, truncated to 8-12 chars). Content-identical uploads produce the same hash.

### deploy-core Package (`packages/deploy-core`)

Fully implemented. The `processRelease()` orchestrator runs the full pipeline:
1. **`safeExtractZip`** — yauzl-based extraction with security validation: path traversal prevention, duplicate rejection, file count / size limits, symlink detection.
2. **`runDetection`** — multi-pass analysis: checks for missing index.html, service workers, source maps, .env/secret files, .git directories, root-path asset references, CSS root references, missing referenced assets dirs, system files.
3. **`buildManifest`** — streaming SHA-256 hashing with concurrency limit (16), deterministic sorting, content-addressed release hash.
4. **`resolveArtifactRoot`** — auto-detects single-top-level-directory zips (e.g., `dist/`) and re-roots paths.

See [packages/deploy-core/src/index.ts](packages/deploy-core/src/index.ts) for the orchestrator, [packages/deploy-core/src/errors.ts](packages/deploy-core/src/errors.ts) for 16 error codes.

### storage Package (`packages/storage`)

Single-file package providing: path helpers (`createStoragePaths`, `createProjectSitePath`, etc.), atomic symlink switching (`switchCurrentReleaseLink`), static asset serving (`resolveStaticAssetPath` with traversal protection, double-decode guarding, index.html SPA fallback), MIME type resolver (`contentTypeForPath`), file I/O helpers (`writeFileToPath`, `copyDirectoryContents`, `ensureReleaseArtifactReady`).

### Web/Desktop Shared UI

`packages/console-app` contains the React UI. `apps/web-shell` and `apps/desktop-shell` are thin shells that inject a `RuntimeAdapter` (`"web"` or `"desktop"` kind) with platform-specific capabilities. **The console app is currently a placeholder** — only renders "ZipShip" and the runtime kind. No pages, routing, or API integration yet.

### Permission Model

Roles: `owner`, `admin`, `developer`, `deployer`, `viewer`. The `permissions` module ([apps/api/src/modules/permissions/](apps/api/src/modules/permissions/)) maintains the role-permission matrix. Business routes must check permissions through the permissions service — never scatter role checks across route handlers.

### Reserved Slugs

Project slugs must match `/^[a-z0-9][a-z0-9_-]*$/` and must not start with `_`. Reserved: `_api`, `_console`, `_health`, `_assets`, `favicon.ico`, `robots.txt`. Defined in [packages/shared/src/index.ts](packages/shared/src/index.ts).

## Test Structure

Tests live in `tests/` and individual packages. Key conventions:

- **`tests/unit/`** — Full HTTP route tests via Eden Treaty client. Test the entire `createApp()` including auth, middleware, error mapping. Each test creates fresh state via `createApp()` with in-memory repos.
- **`packages/*/tests/`** — Package-level unit tests (e.g., deploy-core's detect, unzip, hash, manifest tests, storage tests).
- **`tests/nginx/`** — Nginx routing integration tests (auto-skips on Windows).
- Tests use `createTempStorageRoot()` + `try/finally` cleanup pattern for filesystem tests.
- Cross-platform: tests should use `join()` for path construction and `normalizePath()` helpers for comparing `readlinkSync` output on Windows.
