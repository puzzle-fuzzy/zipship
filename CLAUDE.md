# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ZipShip is a self-hosted static artifact deployment tool — think lightweight Netlify/Vercel self-hosted. Users upload built static assets (zip or folder), the platform detects, versions, serves preview URLs, publishes releases, and supports rollback.

## Commands

```bash
# Development (each kills its port before starting)
bun run dev:api        # API server on http://localhost:3001
bun run dev:web        # Web shell on http://127.0.0.1:5173
bun run dev:desktop    # Electron shell on http://127.0.0.1:5174

# Testing
bun test               # Run all tests (root + packages)
bun test tests/unit/auth-routes.test.ts  # Single file
bun test -- --grep "logout"              # Filter by name

# Type checking
bun run typecheck      # Typecheck all packages (uses turbo)

# Database (requires PostgreSQL running)
bun run db:generate    # Generate Drizzle migrations
bun run db:migrate     # Apply Drizzle migrations

# Database lifecycle
bun run db:up          # docker compose up -d
bun run db:down        # docker compose down
```

Environment variables from `.env` at repo root. Copy `.env.example` to `.env`. Frontend uses `VITE_`-prefixed vars; `DATABASE_URL`, `ZIPSHIP_STORAGE_ROOT` are server-only.

## Architecture

### Monorepo (Bun Workspaces + Bun Catalogs)

```
apps/api              Bun + Elysia backend (control plane) — PostgreSQL via Drizzle
apps/web-shell        Vite + React + Tailwind CSS v4 entry (thin shell)
apps/desktop-shell    Electron entry (thin shell)
packages/console-app  Shared React UI — shadcn/ui + Tailwind CSS v4 + Zustand
packages/db           Drizzle ORM schema + migrations (PostgreSQL)
packages/deploy-core  Unzip, detect, hash, manifest, publish, rollback
packages/storage      File system abstraction (local filesystem, S3/MinIO later)
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

**Error handling**: Services return success OR typed error objects. Controllers map errors to HTTP status codes. Error responses contain only stable `code` strings (e.g. `"DUPLICATE_EMAIL"`), never user-facing text. Frontend maps codes to i18n.

**Auth**: Bearer tokens with SHA-256 hashed refresh tokens. 7-day TTL. Server-side session revocation (`POST /_api/auth/logout` sets `revokedAt`). All `parseBearerToken` functions are case-insensitive (`bearer`/`Bearer`).

**Type safety**: `apps/api` exports `type App = typeof app`. `packages/api-client` uses `treaty<App>()` for typed client.

### Implemented API Modules

| Module | Routes | Notes |
|--------|--------|-------|
| auth | `POST /register`, `POST /login`, `GET /me`, `POST /logout` | Email normalization, session + refresh token, revocation |
| organizations | `GET /` | List user's orgs |
| projects | `POST /`, `GET /`, `GET /:id`, `PATCH /:id` | Slug validation, slug uniqueness, owner/admin update only |
| members | `GET /` (org-scoped) | List members with user info, role badges |
| invitations | `POST /` (org-scoped) | Invite by email, role selection, duplicate/prevent checks |
| releases | `GET /` | List project releases |
| deployments | `POST /publish`, `POST /rollback`, `GET /deployments` | Writes filesystem artifacts |
| uploads | `POST /`, `PUT /raw`, `GET /:id`, `POST /complete` | Create task → upload raw → process → complete lifecycle |
| site-preview | `GET /`, `GET /*` | Internal preview at `/_sites/:slug/:hash/` |
| permissions | internal service | RBAC: owner/admin/developer/deployer/viewer |
| audit | internal service | Logs operations |

### Frontend Tech Stack

**`packages/console-app`** is the shared React UI:
- **Tailwind CSS v4** with `@import "tailwindcss"` (no tailwind.config.js). CSS variables in `index.css`.
- **shadcn/ui** "radix-nova" style using `@base-ui/react` + `radix-ui`. 36 components in `src/components/ui/`.
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
- `release_hash` = content-derived (manifest hash, truncated to 8-12 chars).

### Upload Flow

Frontend supports three upload modes: ZIP file, folder (webkitdirectory → JSZip), single HTML file (JSZip wrapper). The pipeline:
1. `POST /uploads` → create upload task (sends filename + size)
2. `PUT /uploads/:id/raw` → upload raw bytes
3. `POST /uploads/:id/complete` → trigger `processRelease()` (unzip → detect → hash → manifest)

## Test Structure

Tests live in `tests/` and `packages/*/tests/`.

- **`tests/unit/`** — Full HTTP route tests via Eden Treaty client against `createApp({ db })`. Each test creates a fresh PostgreSQL connection and uses `beforeEach` with `truncateAllTables()`. Database must be running.
- **`tests/e2e/`** — Multi-step end-to-end flows (register → login → create project → upload → deploy).
- **`packages/deploy-core/tests/`** — Pure unit tests (zip extraction, detection, manifest hashing, pipeline orchestration). Use fixtures in `packages/deploy-core/tests/fixtures/`.
- **`packages/storage/tests/`** — Filesystem tests using `createTempStorageRoot()` + `try/finally` cleanup pattern.
- **`tests/nginx/`** — Nginx routing tests (auto-skips on Windows).

Testing conventions:
- Integration tests use the **real PostgreSQL via Drizzle** (not in-memory repos).
- The in-memory repo at `apps/api/src/modules/auth/repository.ts` is used only for unit-style service tests (auth-login, auth-registration).
- Use `createTestDbClient()` + `truncateAllTables()` for DB reset between tests.
- For filesystem tests, always use `createTempStorageRoot()` + cleanup in `try/finally`.
- Cross-platform path handling: use `join()`, `normalizePath()` helpers.
- Auth tests should verify error response shape is exactly `{ code: string }` (no extra fields).
- Bearer token tests should cover both `bearer` and `Bearer` (case-insensitive).
