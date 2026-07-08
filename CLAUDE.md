# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ZipShip is a self-hosted static artifact deployment tool — think lightweight Netlify/Vercel self-hosted. Users upload built static assets (zip or folder), the platform detects, versions, serves preview URLs, publishes releases, and supports rollback.

## Commands

```bash
# Development
bun run dev            # API + web-shell simultaneously (Turbo)
bun run dev:api        # API server on http://localhost:3001
bun run dev:web        # Web shell on http://127.0.0.1:5173
bun run dev:desktop    # Tauri desktop shell (renderer on http://localhost:1420)
# (Each dev:target kills its port before starting via scripts/kill-port.ts)

# Testing
bun test               # Run all tests (root + packages)
bun test tests/unit/auth-routes.test.ts  # Single file
bun test -- --grep "logout"              # Filter by name
# pretest auto-starts Docker postgres, creates zipship_test DB, runs migrations

# Type checking
bun run typecheck      # Root project only
bun run typecheck:workspaces  # All packages via Turbo

# Database
bun run db:up          # docker compose up -d
bun run db:down        # docker compose down
bun run db:generate    # Generate Drizzle migrations
bun run db:migrate     # Apply Drizzle migrations
bun run db:create-test # Create zipship_test database in the postgres container
```

Environment variables from `.env` at repo root. Copy `.env.example` to `.env`. Frontend uses `VITE_`-prefixed vars; `DATABASE_URL`, `ZIPSHIP_STORAGE_ROOT` are server-only.

## Architecture

### Monorepo (Bun Workspaces + Bun Catalogs)

```
apps/api              Bun + Elysia backend (control plane) — PostgreSQL via Drizzle
apps/web-shell        Vite + React + Tailwind CSS v4 entry (thin shell)
apps/desktop-shell    Tauri entry (thin shell)
packages/console-app  Shared React UI — shadcn/ui + Tailwind CSS v4 + Zustand
packages/db           Drizzle ORM schema + migrations (PostgreSQL)
packages/deploy-core  Unzip, detect, hash, manifest, publish, rollback
packages/storage      File system abstraction (local filesystem today; StorageAdapter interface + S3/MinIO planned)
packages/api-client   Eden Treaty client — type-safe API calls
packages/runtime      RuntimeAdapter interface (web vs desktop capabilities)
packages/shared       Shared types, constants, reserved slugs
packages/config       Env and path configuration
```

Dependency versions use root `package.json` `catalog` field; sub-packages use `"catalog:"`. Cross-package deps use `"workspace:*"`.

### Control Plane vs Access Plane

- **Elysia** = control plane (`/_api/`). Auth, projects, uploads, deployments, members, invitations.
- **Nginx** = access plane (serves user static artifacts, SPA fallback, tail-slash redirects, Cache-Control headers). Template at [infra/nginx/zipship.conf](infra/nginx/zipship.conf).
- **PostgreSQL** = all metadata (users, sessions, orgs, projects, releases, deployments, audit logs, upload tasks). **Fully wired** via Drizzle ORM.
- **File system** = artifact storage (uploaded zips, extracted sites, symlinked `current`).

### API Module Convention (Elysia Feature-Based)

Each domain in `apps/api/src/modules/:feature/` follows:

- `index.ts` — Elysia plugin (controller). Exports named factory function receiving dependencies.
- `model.ts` — TypeBox (`t.Object`) validation schemas, derived types, error classes.
- `service.ts` — Business logic class. Receives repository interfaces, hash functions, clock via constructor. Never touches HTTP context.
- `drizzle-repository.ts` — Drizzle implementation of the repository interface.

Shared cross-module helpers live in `apps/api/src/lib/` (e.g. `auth.ts` for bearer-token parsing + session resolution). Don't redefine these per module.

**Error handling**: Services return success OR typed error objects. Controllers map errors to HTTP status codes. Error responses contain only stable `code` strings (e.g. `"DUPLICATE_EMAIL"`), never user-facing text. Frontend maps codes to i18n.

**Auth**: Bearer tokens with SHA-256 hashed refresh tokens. 7-day TTL. Server-side session revocation (`POST /_api/auth/logout` sets `revokedAt`). The shared `parseBearerToken` in `apps/api/src/lib/auth.ts` is case-insensitive (`bearer`/`Bearer`); services import it instead of redefining.

**Type safety**: `apps/api` exports `type App = typeof app`. `packages/api-client` uses `treaty<App>()` for typed client.

**App initialization**: `createApp({ db?, storageRoot?, exposeTestRoutes? })` assembles the full Elysia app with dependency injection. Each module receives its repository implementations, hash functions, and clock via its options object — tests replace `db` with a fresh Drizzle connection.

**Auth repository**: a single Drizzle implementation at `apps/api/src/modules/auth/drizzle-repository.ts` (production + integration tests). The old in-memory implementation was removed (it had no importers); pure service tests in `tests/unit/auth-login` / `auth-registration` inject lightweight inline stub repositories.

### Implemented API Modules

| Module | Routes | Notes |
|--------|--------|-------|
| auth | `POST /register`, `POST /login`, `GET /me`, `PATCH /me`, `POST /logout` | Email normalization, register creates session directly, SHA-256 refresh tokens, server-side revocation |
| organizations | `GET /` | List user's orgs via membership |
| projects | `POST /`, `GET /`, `GET /:id`, `PATCH /:id`, `DELETE /:id` | Slug validation + uniqueness, owner/admin-only mutate |
| members | `GET /` (org-scoped) | List members with user info, role badges |
| invitations | `POST /` (org-scoped) | Invite by email, role selection, duplicate/prevent checks |
| releases | `GET /` | List project releases (newest first) |
| deployments | `POST /publish`, `POST /rollback`, `GET /deployments` | Atomic symlink swap via `switchCurrentReleaseLink`, audit logged |
| uploads | `POST /`, `PUT /raw`, `POST /complete`, `GET /:id` | 3-step pipeline, triggers release-processing on complete |
| site-preview | `GET /`, `GET /*` | Internal preview at `/_sites/:slug/:hash/` with SPA fallback |
| permissions | internal service | RBAC: 5 roles × 9 actions matrix in `permissions/service.ts` |
| audit | internal service | Logs operations to `audit_logs` table |
| release-processing | internal service | Calls deploy-core `processRelease()` → extract → detect → manifest → store |

**Session storage**: Refresh tokens stored in `sessionStorage` keyed as `zipship_refresh_token`. On app mount, `authStore.initSession()` calls `GET /_api/auth/me` with the stored token — if it fails, redirects to login. Logout removes the key and resets store.

**Test API pattern**: Tests wire `window.__ZIPSHIP_API_BASE_URL` via `createApp({db})` by importing the Eden Treaty client directly against the test app instance — no HTTP server needed.

### Frontend Tech Stack

**`packages/console-app`** is the shared React UI:
- **Tailwind CSS v4** with `@import "tailwindcss"` (no tailwind.config.js). CSS variables in `index.css`.
- **shadcn/ui** "radix-nova" style using `@base-ui/react` + `radix-ui`. 32 components in `src/components/ui/`.
- **Icons**: `lucide-react`.
- **State**: Zustand v5 stores: `authStore`, `projectsStore`, `membersStore`, `settingsStore`.
- **i18n**: Custom hook `useTranslation()` with `en.ts` / `zh.ts` maps.
- **Routing**: React Router 7 (browser router).
- **Theme**: `.night` class on `<html>` toggled via `settingsStore`.

Key patterns:
- `apiBaseUrl` exposed via `window.__ZIPSHIP_API_BASE_URL`.
- Each store uses `createApiClient(apiBaseUrl)` for type-safe API calls via Eden Treaty.
- Error codes from API are mapped to user-facing messages in stores (not in UI components).

### Permission Model

Roles: `owner` → `admin` → `developer` → `deployer` → `viewer`. Matrix in `permissions/service.ts`. Key checks:
- `invite_member`: owner/admin only
- `manage_member`: owner/admin only
- `create_project`: developer+
- `upload_release`: developer+
- `publish_release` / `rollback_release`: deployer+
- `view_project`: all roles

### Database (Drizzle ORM)

Schema at [packages/db/src/schema.ts](packages/db/src/schema.ts). Core tables: `users`, `sessions` (with `revokedAt`), `organizations`, `members` (role: owner/admin/developer/deployer/viewer), `invitations`, `projects`, `releases`, `deployments`, `upload_tasks`, `audit_logs`.

### Release Model

- **Release** = immutable artifact version. Status flow: `uploading → processing → ready → active | failed | archived | deleted`.
- **Deployment** = publish/rollback action. Links a release to `current`.
- **current** = symlink `sites/:slug/current → releases/:hash`. Zero-downtime via `symlink → rename`.
- `release_hash` = content-derived (manifest hash, truncated to 12 chars).

### Upload Flow

Frontend supports three upload modes: ZIP file, folder (webkitdirectory → JSZip), single HTML file (JSZip wrapper). The pipeline:
1. `POST /uploads` → create upload task (sends filename + size)
2. `PUT /uploads/:id/raw` → upload raw bytes
3. `POST /uploads/:id/complete` → trigger `processRelease()` (unzip → detect → hash → manifest)

## Test Structure

Tests live in `tests/` and `packages/*/tests/`. Run with `bun test` — `pretest` auto-starts Docker PostgreSQL, creates `zipship_test` database, and runs migrations against it.

- **`tests/unit/`** — Pure-logic tests (services with inline stub repos, slug/permission/storage helpers). No DB required. Run with `bun run test:unit`.
- **`tests/integration/`** — Full HTTP route tests via Eden Treaty client against `createApp({ db })`. Each test creates a fresh PostgreSQL connection and uses `beforeEach` with `truncateAllTables()`. Database must be running. Run with `bun run test:integration`.
- **`tests/e2e/`** — Multi-step end-to-end flows (register → login → create project → upload → deploy).
- **`packages/deploy-core/tests/unit/`** — Pure unit tests (zip extraction, detection, manifest hashing, pipeline orchestration). Use fixtures in `packages/deploy-core/tests/fixtures/` (`.zip` files at various sizes).
- **`packages/storage/tests/`** — Filesystem tests using `createTempStorageRoot()` + `try/finally` cleanup pattern.
- **`tests/nginx/`** — Nginx routing tests (auto-skips on Windows).
- **`tests/helpers/path.ts`** — Cross-platform path utilities (`readLinkTarget`, `normalizePath`).

Testing conventions:
- Route-level tests use the **real PostgreSQL via Drizzle** — create a Drizzle connection, pass to `createApp({ db })`, truncate all tables between tests with `truncateAllTables()`.
- Pure service tests (`tests/unit/auth-login`, `auth-registration`) inject inline stub repositories; no in-memory repo ships in the source tree.
- For filesystem tests, always use `createTempStorageRoot()` + cleanup in `try/finally`.
- Cross-platform path handling: use `join()`, `normalizePath()` helpers.
- Auth tests should verify error response shape is exactly `{ code: string }` (no extra fields).
- Bearer token tests should cover both `bearer` and `Bearer` (case-insensitive).
