# Release Integrity Gate

**Date:** 2026-07-22
**Status:** Approved (design)
**Scope:** The first production-readiness subproject only: CI reuse, tag-release gating, pinned tool versions, local guardrails, and evidence/documentation rules. No application behavior changes.

## Goal

Make it impossible for a semantic-version tag to publish ZipShip container images unless the exact tagged commit has passed the same Rust, frontend, external-service, and production-distribution verification required for an ordinary pull request.

## Background

The repository already has substantial verification, but the evidence chain is split:

- `.github/workflows/ci.yml` runs on `main` pushes and pull requests. Its Rust job runs formatting, Clippy, migrations, regular tests, real PostgreSQL repository tests, Mailpit SMTP tests, and the real Worker HTTP pipeline. Its frontend job runs the Rust-cutover gate, OpenAPI drift check, lint, type checks, tests, and builds. A production smoke job then builds the final images and exercises the HTTPS upload/publish/access path.
- `.github/workflows/release-images.yml` runs independently for `v*.*.*` tags and immediately builds and pushes multi-architecture images. It does not depend on the CI result for the tagged commit and does not rerun CI verification itself.
- The root package declares `bun@1.3.14`, but only the production-smoke job explicitly pins that version. The frontend job currently delegates version selection to `setup-bun`.
- The repository records that the previous Windows production smoke did not reach container startup. The current local environment also cannot reach a Docker daemon. Consequently, workflow presence is not evidence that the complete production path has passed.

This design closes the workflow gap and defines the evidence required before the subproject can be called complete. Repairing Docker Desktop itself is an environment task, not a repository change.

## Confirmed Program Decisions

1. Work proceeds in risk order: release evidence, product truth, production safety, tenant security, product completion, then Desktop and visual consistency.
2. Work is isolated in `G:\zipship\.worktrees\zipship-production-readiness` on `codex/zipship-production-readiness`, preserving the user's uncommitted Console work in the primary checkout.
3. Each independently reviewable issue receives its own commit. The branch is not merged into the dirty primary checkout automatically.
4. A failed or unavailable external verification is reported as unverified. It is never converted into a passing status by a local unit test or static workflow check.

## Chosen Approach

Extract all verification jobs into one reusable workflow and invoke that workflow from both normal CI and the tag-release workflow.

This was selected over two alternatives:

- Duplicating the CI jobs inside `release-images.yml` would gate releases, but creates two verification definitions that will drift.
- Querying historical check runs for a tagged SHA would avoid rerunning work, but depends on check naming, permissions, branch protection, and external API state. It is easier to misconfigure and does not prove that a tag created from an unverified local commit has been tested.

Rerunning the canonical reusable workflow on a tag costs additional CI time, but gives the strongest and simplest invariant: the exact tag commit is verified immediately before image publication.

## Architecture

### 1. Canonical reusable verification workflow

Create `.github/workflows/verify.yml` with `workflow_call` and three jobs:

1. `rust`
   - Preserve the PostgreSQL 17 and Mailpit services.
   - Preserve `cargo fmt`, Clippy with warnings denied, explicit migration, regular workspace tests, ignored SMTP tests, ignored PostgreSQL repository tests, and the ignored Worker pipeline test.
   - Continue using the repository's pinned Rust toolchain.
2. `frontend`
   - Pin Bun to `1.3.14` explicitly.
   - Install with the frozen lockfile.
   - Run cutover, OpenAPI, release-integrity, lint, root/workspace type checks, frontend tests, and builds.
3. `production-smoke`
   - Depend on both `rust` and `frontend`.
   - Pin Bun to `1.3.14` explicitly.
   - Run the existing isolated production smoke without weakening its cleanup or HTTPS behavior.

The reusable workflow needs only read access to repository contents. It must not receive package-write permission and must not publish artifacts or images.

### 2. Thin normal-CI caller

Keep the existing `main` push and pull-request triggers in `.github/workflows/ci.yml`, but replace the duplicated job bodies with one local reusable-workflow call:

```yaml
jobs:
  verify:
    uses: ./.github/workflows/verify.yml
```

This preserves current CI coverage while ensuring future verification changes have one source of truth.

### 3. Tag release gate

Add a `verify` job to `.github/workflows/release-images.yml` that calls the same local reusable workflow. Make every matrix image publication depend on it:

```yaml
jobs:
  verify:
    uses: ./.github/workflows/verify.yml

  publish:
    needs: verify
```

The existing immutable action pins, GHCR login, multi-architecture targets, image tags, provenance, and SBOM settings remain unchanged. `packages: write` stays available to the publishing workflow, but no registry login or package mutation occurs before verification succeeds.

GitHub resolves a local reusable workflow from the same ref as the caller. On a tag event, this means both the verification definition and the code under test come from the tagged commit.

### 4. Repository guardrail

Create `scripts/check-release-integrity.ts` and expose it as `bun run release:check`.

The checker reads the three workflow files and fails with a stable, actionable message unless all of these invariants are present:

- `verify.yml` exists and declares `workflow_call`.
- It contains the `rust`, `frontend`, and `production-smoke` jobs.
- Both Bun setup steps explicitly select `1.3.14`.
- `ci.yml` invokes `./.github/workflows/verify.yml`.
- `release-images.yml` invokes the same workflow.
- The image-publishing job declares `needs: verify`.
- The release trigger remains restricted to semantic-version-shaped `v*.*.*` tags.

This is a structural regression guard, not a full YAML interpreter. GitHub remains the authority for workflow syntax and runtime behavior. The checker is added to the reusable frontend job, so later changes cannot silently remove their own release gate.

The implementation follows a red-green sequence: introduce the checker and script entry first, run it against the current workflows and observe the expected failure, then refactor the workflows and rerun it successfully.

### 5. Evidence and documentation

Update the production documentation to distinguish four levels of evidence:

1. Static workflow guard passed.
2. Local non-Docker checks passed.
3. Production smoke passed in a clean Docker environment.
4. The pushed branch or pull request passed the canonical remote verification workflow.

Only levels 3 and 4 together support a production-distribution readiness claim. If GitHub authentication or Docker is unavailable, the implementation may be complete locally, but the subproject remains externally unverified.

Correct the stale README statements while touching release documentation:

- Production Compose consumes published images; it does not build from source on the server.
- Public API and Access origins are injected through `/runtime-config.js`; changing them requires restarting Edge, not rebuilding its image.

## Failure Behavior

- Any Rust, frontend, external-service, or production-smoke failure prevents the reusable workflow from succeeding.
- A failed `verify` job prevents every publish matrix entry from starting.
- The local guard exits nonzero and names the missing invariant.
- A cancelled verification is not considered success and therefore cannot unlock image publication.
- Failure in one image build still follows the current `fail-fast: false` policy after verification; it does not roll back an image that another matrix entry already pushed. Cross-image transactional publication is outside this slice.

## Testing and Verification

### Repository checks

- `bun run release:check`
- `bun run cutover:check`
- `bun run api:check`
- `bun run lint`
- `bun run typecheck`
- `bun run typecheck:workspaces`
- `bun run test`
- `bun run build`
- `bun run rust:fmt`
- `bun run rust:clippy`
- `bun run rust:test`

### Environment-backed checks

- `bun run test:integration`
- `bun run smoke:production`

These commands require the isolated PostgreSQL/Mailpit and Docker environments defined by the project. They must not be pointed at development data.

### Remote acceptance

- Push `codex/zipship-production-readiness` after GitHub authentication is valid.
- Open a pull request into the intended integration branch.
- Confirm that the canonical reusable verification workflow passes for the pull-request commit.
- Do not create a real release tag merely to test the gate; the first authorized release tag will exercise the same reusable workflow before publication.

## Non-goals

- No changes to Rust, Console, Access Plane, Worker, database, storage, or API behavior.
- No Docker Desktop repair or host-machine configuration changes.
- No image signing, changelog generation, release-note automation, or version bump automation.
- No replacement of the existing provenance or SBOM settings.
- No weakening or mocking of PostgreSQL, SMTP, Worker, or production-smoke verification.
- No automatic merge into the primary `rust-dev` checkout while it contains user changes.

## Affected Files

- Create `.github/workflows/verify.yml` — canonical reusable verification jobs.
- Modify `.github/workflows/ci.yml` — normal trigger wrapper.
- Modify `.github/workflows/release-images.yml` — verification dependency before publication.
- Create `scripts/check-release-integrity.ts` — structural release-gate checker.
- Modify `package.json` — add `release:check`; no dependency or lockfile change.
- Modify `README.md` — correct production image and runtime-origin instructions.
- Modify `infra/docker/README.md` or the current Rust implementation record only where needed to document evidence levels and the successful verification date.

## Done Criteria

- Normal CI and tag releases invoke the same reusable verification workflow.
- No image-publishing job can start before that verification succeeds.
- Bun `1.3.14` is explicit in both frontend-related verification jobs.
- `bun run release:check` detects removal of the reusable gate or publish dependency and passes on the committed configuration.
- All repository checks listed above pass.
- Integration and production smoke pass in a clean Docker environment.
- The pushed pull-request commit passes the canonical remote workflow.
- Documentation states the observed evidence accurately and contains no claim that a skipped or blocked smoke passed.
