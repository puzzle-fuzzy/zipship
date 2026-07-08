# Remove ESLint, Adopt Root oxlint

**Date:** 2026-07-08
**Status:** Approved (design)
**Scope:** Root tooling only — `package.json`, `turbo.json`, lockfile. No business-code changes unless oxlint surfaces auto-fixable issues.

## Goal

Remove every ESLint dependency and reference from the ZipShip monorepo, and make the already-present root `oxlint` setup the single linting tool, invocable via a script and a turbo task.

## Background / Current State

- **ESLint is already mostly gone.** There are no ESLint config files anywhere under `apps/` or `packages/` (the previously-deleted `apps/desktop-shell` eslint files are already reflected in git status).
- **The only ESLint references that remain** are 4 entries in the root `package.json` `catalog`:
  - `@typescript-eslint/eslint-plugin` (^8.62.1)
  - `@typescript-eslint/parser` (^8.62.1)
  - `eslint` (^10.6.0)
  - `eslint-plugin-import` (^2.32.0)
  - …plus the corresponding transitive install in `bun.lock` and `node_modules/`.
- **No other references exist:** no CI workflow (`.github/` is absent), no turbo lint task, no sub-package `lint` script. Verified by repo-wide grep (`eslint` appears only in root `package.json` and `bun.lock`).
- **oxlint is already wired but not scripted.** `.oxlintrc.json` is committed at the repo root (`plugins: react, typescript, oxc, import`; `categories.correctness: "error"`; plus `react/rules-of-hooks: error` and `react/only-export-components: warn`). `oxlint@^1.73.0` is installed but sits in root `dependencies`, and there is **no `lint` script** in root `package.json` and **no `lint` task** in `turbo.json`.

This is therefore a cleanup + scripting task, not a config-migration task.

## Decisions (confirmed with user)

1. **Lint workflow:** Root `lint` script **and** a turbo `lint` task.
2. **Verification:** Run oxlint once after wiring; auto-fix only (`--fix`); report non-fixable findings without touching business code.
3. **oxlint location:** Move from `dependencies` → `devDependencies`.
4. **`lint:fix`:** Yes, add it.

## Design

### 1. Remove ESLint dependencies

Edit root `package.json` `catalog` — delete these 4 lines:
- `@typescript-eslint/eslint-plugin`
- `@typescript-eslint/parser`
- `eslint`
- `eslint-plugin-import`

**Safety:** No workspace references these via `"catalog:"` (grep confirmed `eslint` appears only in the root catalog). Removal will not break any `devDependencies` resolution.

Then run `bun install` to regenerate `bun.lock` and prune the ESLint packages from `node_modules/`.

### 2. Move oxlint to devDependencies

In root `package.json`: remove `"oxlint": "^1.73.0"` from `dependencies`; add `"oxlint": "^1.73.0"` to `devDependencies`. (`bun install` reconciles the lockfile.)

### 3. Wire oxlint into scripts + turbo

**Root `package.json` `scripts`** — add:
- `"lint": "oxlint ."`
- `"lint:fix": "oxlint . --fix"`

`oxlint .` lints the entire monorepo from the single root `.oxlintrc.json`. The primary day-to-day entry point is `bun run lint` at the repo root.

**`turbo.json` `tasks`** — add a `lint` task alongside `typecheck`:
```json
"lint": {
  "dependsOn": [],
  "outputs": []
}
```
No `inputs` override: turbo's default content hash for the root workspace covers the linted files, and the root `.oxlintrc.json` participates in that hash. This makes `bun turbo run lint` available and cacheable. Turbo runs `lint` only in workspaces that define the script — only the root does — so the whole-repo lint runs exactly once.

Sub-packages get **no** `lint` script of their own (single root config is sufficient — YAGNI).

### 4. Verify (run once, auto-fix only)

1. `bun run lint` — capture output.
2. `bun run lint:fix` — apply only `--fix`-able corrections (e.g. import ordering, unused variables).
3. `bun run lint` — re-run to confirm the auto-fixed state.
4. **Remaining non-auto-fixable errors are reported to the user verbatim. Business code is not manually edited without explicit sign-off.** If the count is large, surface the breakdown by rule so the user can decide whether to (a) fix manually, (b) relax a rule in `.oxlintrc.json`, or (c) accept.

### 5. Non-goals (YAGNI)

- No per-package oxlint configs — one root config covers the monorepo.
- No change to the existing `.oxlintrc.json` rule set unless step 4 reveals a concrete need.
- No type-aware linting. oxlint does not run `tsc`, so it cannot enforce typescript-eslint's type-checked rules (e.g. `no-floating-promises`, `no-misused-promises`). **This loses nothing** because the project had no ESLint config in `apps/` or `packages/` to begin with — the switch is purely additive. Type safety continues to come from `bun run typecheck`.
- No editor/IDE integration configuration (VS Code oxlint extension) — out of scope unless requested.

## Trade-offs

- **No type-aware rules.** Accepted (see Non-goals). Mitigated by the existing `typecheck` scripts.
- **Whole-repo lint runs as a single root task** rather than per-package. Simpler config; trades fine-grained per-package caching for one root config. Acceptable for a monorepo of this size.

## Affected Files

- `package.json` — remove 4 catalog entries; move `oxlint` to `devDependencies`; add `lint` + `lint:fix` scripts.
- `turbo.json` — add `lint` task.
- `bun.lock` — regenerated by `bun install`.
- `node_modules/` — ESLint packages pruned by `bun install` (not tracked).

No source files are edited unless step 4 auto-fixes them.

## Done criteria

- `eslint` no longer appears anywhere in tracked files except possibly `bun.lock` history.
- `bun install` succeeds; ESLint packages are absent from `node_modules/`.
- `bun run lint` runs oxlint against the repo and exits cleanly after `--fix`.
- `bun turbo run lint` runs the lint task successfully.
- Any non-auto-fixable findings are reported to the user.
