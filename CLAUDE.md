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
bun test               # Run all tests (Bun test runner)

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
packages/deploy-core  Core logic: unzip, detect, hash, publish, rollback
packages/storage      File system abstraction (local now, S3/MinIO later)
packages/api-client   Eden Treaty client — type-safe API calls
packages/runtime      RuntimeAdapter interface (web vs desktop capabilities)
packages/shared       Shared types, constants, reserved slugs
packages/config       Env and path configuration
```

Dependency versions live in root `package.json` `catalog` field; sub-packages reference them via `"catalog:"`. Cross-package deps use `"workspace:*"`.

### Control Plane vs Access Plane

- **Elysia** = control plane (API, auth, management). Does NOT serve production static assets.
- **Nginx** = access plane (serves user artifacts, SPA fallback, tail-slash redirects).
- **PostgreSQL** = metadata (users, projects, releases, audit logs).
- **File system** = artifact storage (zips, extracted sites, symlinked `current`).

Nginx routes: `/_api/` → Elysia, `/_console/` → management UI, `/:slug/` → current release, `/:slug/:hash/` → specific release.

### API Module Convention (Elysia Feature-Based)

Each business domain in `apps/api/src/modules/:feature/` follows this pattern:

- `index.ts` — Elysia plugin (controller). Exports a named plugin function that receives dependencies.
- `model.ts` — TypeBox validation schemas, derived types, and module-specific error classes.
- `service.ts` — Business logic class. Receives dependencies (repository, hash functions, clock) via constructor. Never touches HTTP context.
- `repository.ts` — Data access interface/implementation.

**Error handling rule**: Services return success results OR module error objects (e.g., `AuthServiceError`). Controllers map error objects to HTTP status codes using `status(code, payload)`. API error responses contain only stable `code` strings (e.g., `"DUPLICATE_EMAIL"`), never user-facing text. The frontend handles i18n by mapping error codes to Chinese/English.

**Type safety**: `apps/api` exports `type App = typeof app`. `packages/api-client` uses `@elysia/eden`'s `treaty<App>()` for end-to-end type-safe API calls.

### Database (Drizzle ORM)

Schema is in [packages/db/src/schema.ts](packages/db/src/schema.ts). Core tables: `users`, `organizations`, `members`, `invitations`, `projects`, `releases`, `deployments`, `upload_tasks`, `audit_logs`, `sessions`, `desktop_devices`, `desktop_login_requests`, `desktop_login_tickets`.

Drizzle config is at [packages/db/drizzle.config.ts](packages/db/drizzle.config.ts); root `db:*` scripts explicitly point to it via `--config`.

### Release Model

- **Release** = immutable artifact version. Created after upload + unzip + detect + hash. Statuses: `uploading → processing → ready → active | failed | archived | deleted`.
- **Deployment** = the action of publishing/rolling back. Links a release to the `current` position.
- **current** = symlink `sites/:slug/current → releases/:hash`. Publishing = atomically relinking this symlink.

`release_hash` is derived from content (manifest hash, truncated to 8-12 chars). Content-identical uploads produce the same hash.

### Web/Desktop Shared UI

`packages/console-app` contains the React UI. `apps/web-shell` and `apps/desktop-shell` are thin shells that inject a `RuntimeAdapter` (`"web"` or `"desktop"` kind) with platform-specific capabilities (file picking, archiving, external URL opening, deep links). Both shells currently render the same placeholder `<ConsoleApp>`.

### Permission Model

Roles: `owner`, `admin`, `developer`, `deployer`, `viewer`. The `permissions` module ([apps/api/src/modules/permissions/](apps/api/src/modules/permissions/)) maintains the role-permission matrix. Business routes must check permissions through the permissions service — never scatter role checks across route handlers.

### Current Implementation State

The API has in-memory repositories implementing the defined service interfaces. Implemented modules: `auth` (register, login, me), `organizations`, `projects`, `releases`, `uploads`, `audit`, `permissions`. Tests are in [tests/unit/](tests/unit/) covering these modules. Core deploy logic (`packages/deploy-core`) currently only has slug validation; unzip, detect, hash, and symlink management are not yet implemented.

### Reserved Slugs

Project slugs must match `/^[a-z0-9][a-z0-9_-]*$/` and must not start with `_`. Reserved: `_api`, `_console`, `_health`, `_assets`, `favicon.ico`, `robots.txt`. Defined in [packages/shared/src/index.ts](packages/shared/src/index.ts).
