# Release Integrity Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: execute this plan inline with test-first checkpoints; do not delegate because this repository task has one shared workflow/configuration state.

**Goal:** Gate every semantic-version image release on the exact same complete verification workflow used by pull requests, and add a local regression check for that invariant.

**Architecture:** Move the existing Rust, frontend, and production-smoke jobs into one `workflow_call` workflow. Keep `ci.yml` as a trigger-only caller and make `release-images.yml` call verification before any registry mutation. A Bun structural checker protects the cross-workflow dependency from later drift.

**Tech Stack:** GitHub Actions YAML, Bun 1.3.14, TypeScript, existing Rust/Cargo and Docker Compose verification commands.

## Global Constraints

- Preserve the final Rust architecture and all existing real PostgreSQL, SMTP, Worker, and HTTPS smoke coverage.
- Do not add dependencies or change `bun.lock`.
- Do not alter application behavior, database schema, API contracts, container contents, or image metadata.
- Treat unavailable Docker or GitHub execution as unverified, never passed.
- Preserve the user's dirty primary checkout; all implementation happens in `G:\zipship\.worktrees\zipship-production-readiness`.
- Each independently complete issue receives its own commit.

---

## File Map

- `.github/workflows/verify.yml`: single reusable definition of Rust, frontend, and production-smoke verification.
- `.github/workflows/ci.yml`: `main`/pull-request trigger that calls `verify.yml`.
- `.github/workflows/release-images.yml`: tag trigger that calls `verify.yml`, then publishes images only after success.
- `scripts/check-release-integrity.ts`: text-structural regression checker for the release gate.
- `package.json`: exposes `bun run release:check`.
- `README.md`: corrects production image consumption and runtime-origin instructions.
- `infra/docker/README.md`: documents the four evidence levels and the release gate.

### Task 1: Establish the isolated baseline

**Files:** No tracked files change.

**Interfaces:**
- Consumes: committed `bun.lock`, Cargo workspace, and the clean worktree.
- Produces: installed workspace dependencies and recorded baseline status.

- [ ] **Step 1: Install exactly the locked dependencies**

Run:

```powershell
bun install --frozen-lockfile
```

Expected: exit 0; `bun.lock` remains unchanged.

- [ ] **Step 2: Confirm the branch and tracked baseline are clean**

Run:

```powershell
git status --short --branch
git diff --check
```

Expected: branch is `codex/zipship-production-readiness`; no tracked modifications are reported.

### Task 2: Add the failing release-integrity guard, then make the workflows satisfy it

**Files:**
- Create: `scripts/check-release-integrity.ts`
- Create: `.github/workflows/verify.yml`
- Modify: `package.json`
- Modify: `.github/workflows/ci.yml`
- Modify: `.github/workflows/release-images.yml`

**Interfaces:**
- Consumes: the three workflow files as UTF-8 text.
- Produces: `bun run release:check`, which exits 0 only when normal CI and releases call the reusable workflow and `publish` depends on `verify`.

- [ ] **Step 1: Create the structural checker**

Create `scripts/check-release-integrity.ts` with:

```typescript
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const failures: string[] = [];

function readRequired(relativePath: string): string {
  const path = join(root, relativePath);
  if (!existsSync(path)) {
    failures.push(`${relativePath} is missing`);
    return "";
  }
  return readFileSync(path, "utf8").replaceAll("\r\n", "\n");
}

function requireMatch(source: string, pattern: RegExp, failure: string): void {
  if (!pattern.test(source)) failures.push(failure);
}

function jobBlock(source: string, job: string, relativePath: string): string {
  const lines = source.split("\n");
  const start = lines.findIndex((line) => line === `  ${job}:`);
  if (start < 0) {
    failures.push(`${relativePath} is missing the ${job} job`);
    return "";
  }

  const next = lines.findIndex(
    (line, index) => index > start && /^  [a-zA-Z0-9_-]+:\s*$/u.test(line),
  );
  return lines.slice(start, next < 0 ? undefined : next).join("\n");
}

const verifyPath = ".github/workflows/verify.yml";
const ciPath = ".github/workflows/ci.yml";
const releasePath = ".github/workflows/release-images.yml";
const verify = readRequired(verifyPath);
const ci = readRequired(ciPath);
const release = readRequired(releasePath);

requireMatch(
  verify,
  /^on:\s*\n  workflow_call:\s*$/mu,
  `${verifyPath} must declare workflow_call`,
);
jobBlock(verify, "rust", verifyPath);
jobBlock(verify, "frontend", verifyPath);
jobBlock(verify, "production-smoke", verifyPath);

const bunPins = verify.match(/^\s+?bun-version:\s*1\.3\.14\s*$/gmu) ?? [];
if (bunPins.length !== 2) {
  failures.push(`${verifyPath} must pin Bun 1.3.14 in exactly two jobs`);
}

const reusableCall = /uses:\s*\.\/\.github\/workflows\/verify\.yml\s*$/mu;
requireMatch(ci, reusableCall, `${ciPath} must call ${verifyPath}`);
requireMatch(release, reusableCall, `${releasePath} must call ${verifyPath}`);
requireMatch(
  jobBlock(release, "publish", releasePath),
  /^    needs:\s*verify\s*$/mu,
  `${releasePath} publish must need verify`,
);
requireMatch(
  release,
  /^      - "v\*\.\*\.\*"\s*$/mu,
  `${releasePath} must retain the v*.*.* tag trigger`,
);

if (failures.length > 0) {
  console.error("Release integrity gate failed:\n");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Release integrity gate passed: canonical verification blocks image publication.");
```

- [ ] **Step 2: Add the package script**

Add this entry beside `cutover:check` in the root `package.json` scripts:

```json
"release:check": "bun scripts/check-release-integrity.ts"
```

- [ ] **Step 3: Run the checker and verify the RED state**

Run:

```powershell
bun run release:check
```

Expected: exit 1. The output must say that `.github/workflows/verify.yml` is missing, `ci.yml` and `release-images.yml` do not call it, and `publish` does not need `verify`.

- [ ] **Step 4: Create the canonical reusable workflow**

Create `.github/workflows/verify.yml` by moving the existing job definitions out of `ci.yml`. Its complete top-level structure is:

```yaml
name: Verify

on:
  workflow_call:

permissions:
  contents: read

jobs:
  rust:
    name: Rust
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:17-alpine
        env:
          POSTGRES_USER: zipship
          POSTGRES_PASSWORD: zipship
          POSTGRES_DB: zipship_rust_test
        ports:
          - 5432:5432
        options: >-
          --health-cmd "pg_isready -U zipship"
          --health-interval 5s
          --health-timeout 5s
          --health-retries 10
      mailpit:
        image: axllent/mailpit:v1.30.3
        ports:
          - 1025:1025
    env:
      ZIPSHIP_DATABASE_URL: postgres://zipship:zipship@localhost:5432/zipship_rust_test
      ZIPSHIP_TEST_DATABASE_URL: postgres://zipship:zipship@localhost:5432/zipship_rust_test
      ZIPSHIP_STORAGE_ROOT: /tmp/zipship-rust-storage
    steps:
      - uses: actions/checkout@df4cb1c069e1874edd31b4311f1884172cec0e10 # v6
      - name: Install pinned Rust toolchain
        run: rustup show
      - run: cargo fmt --all -- --check
      - run: cargo clippy --workspace --all-targets -- -D warnings
      - run: cargo run -p zipshipd -- migrate
      - run: cargo test --workspace --all-targets
      - run: ZIPSHIP_TEST_SMTP_URL=smtp://localhost:1025 cargo test -p zipship-mail --test smtp_mailpit -- --ignored
      - run: cargo test -p zipship-postgres --tests -- --ignored --test-threads=1
      - run: cargo test -p zipship-worker --test artifact_pipeline -- --ignored --test-threads=1

  frontend:
    name: Frontend
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@df4cb1c069e1874edd31b4311f1884172cec0e10 # v6
      - uses: oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6 # v2
        with:
          bun-version: 1.3.14
      - run: bun install --frozen-lockfile
      - run: bun run cutover:check
      - run: bun run api:check
      - run: bun run release:check
      - run: bun run lint
      - run: bun run typecheck
      - run: bun run typecheck:workspaces
      - run: bun run test
      - run: bun run build

  production-smoke:
    name: Production distribution smoke
    needs: [rust, frontend]
    runs-on: ubuntu-latest
    timeout-minutes: 45
    steps:
      - uses: actions/checkout@df4cb1c069e1874edd31b4311f1884172cec0e10 # v6
      - uses: oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6 # v2
        with:
          bun-version: 1.3.14
      - run: bun install --frozen-lockfile
      - run: bun run smoke:production
```

- [ ] **Step 5: Replace normal CI with the thin caller**

Replace `.github/workflows/ci.yml` with:

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

permissions:
  contents: read

jobs:
  verify:
    uses: ./.github/workflows/verify.yml
```

- [ ] **Step 6: Gate release publication**

In `.github/workflows/release-images.yml`, insert this job before `publish`:

```yaml
  verify:
    uses: ./.github/workflows/verify.yml

  publish:
    needs: verify
```

Keep the existing `publish` matrix, permissions, action SHA pins, image metadata, provenance, and SBOM configuration byte-for-byte except for the new `needs` property.

- [ ] **Step 7: Run the checker and verify the GREEN state**

Run:

```powershell
bun run release:check
```

Expected: exit 0 and `Release integrity gate passed: canonical verification blocks image publication.`

- [ ] **Step 8: Run focused configuration checks**

Run:

```powershell
bun run cutover:check
bun run lint
bun run typecheck
git diff --check
```

Expected: every command exits 0. Confirm `bun.lock` has no diff.

- [ ] **Step 9: Commit the release gate**

Stage only the workflow, checker, and package files, then commit:

```powershell
git add .github/workflows/verify.yml .github/workflows/ci.yml .github/workflows/release-images.yml scripts/check-release-integrity.ts package.json
git commit -m "ci: gate image releases on verification"
```

### Task 3: Correct production documentation and define evidence levels

**Files:**
- Modify: `README.md:77-104`
- Modify: `infra/docker/README.md:63-71`

**Interfaces:**
- Consumes: the implemented reusable workflow and runtime Caddy configuration.
- Produces: operator instructions that distinguish static, local, Docker, and remote evidence.

- [ ] **Step 1: Correct the README deployment command and runtime-origin statement**

Replace the statement that origins are baked into the Edge build with:

```markdown
先复制 [production.env.example](infra/docker/production.env.example) 到仓库外的受保护路径并替换所有占位符。Console/API/Access 应使用同一主域下的三个 HTTPS 子域。Edge 在启动时通过同源 `/runtime-config.js` 注入 API/Access Origin；修改公共 Origin 后只需重启 Edge，不需要重建镜像。
```

Replace `up -d --build --wait` with `up -d --wait`, and state immediately before the command that production Compose consumes immutable `ZIPSHIP_SERVER_IMAGE` and `ZIPSHIP_EDGE_IMAGE` references.

- [ ] **Step 2: Add the evidence model to the Docker runbook**

Append this section after the key operational constraints:

```markdown
### 发行证据等级

1. `bun run release:check` 只证明工作流结构仍有发布门禁。
2. 本地 lint、类型、测试和构建只证明非 Docker 检查通过。
3. `bun run test:integration` 与 `bun run smoke:production` 成功，才证明隔离数据库、SMTP、Worker、最终镜像和 HTTPS 发布链在该环境通过。
4. Pull Request 或标签对应提交的远端 `Verify` 工作流成功，才证明进入发行链的确切提交通过统一门禁。

只有第 3、4 级同时成立时，才可以把当前提交记为生产发行验证通过。Docker 或 GitHub 不可用时必须记录为未验证，不能用较低等级替代。
```

- [ ] **Step 3: Verify documentation consistency**

Run:

```powershell
rg -n "构建时固化|up -d --build|runtime-config.js|发行证据等级" README.md infra/docker/README.md
git diff --check
```

Expected: stale phrases are absent; runtime config and evidence-level text are present; diff check exits 0.

- [ ] **Step 4: Commit documentation separately**

```powershell
git add README.md infra/docker/README.md
git commit -m "docs: clarify production release evidence"
```

### Task 4: Run complete local verification and record external boundaries

**Files:** No tracked file changes unless both environment-backed and remote verification succeed and an observed-success record is added with its exact date and commit SHA.

**Interfaces:**
- Consumes: the complete release-integrity implementation.
- Produces: command evidence and a precise list of any external blockers.

- [ ] **Step 1: Run all non-Docker checks**

Run every command independently and retain its exit code:

```powershell
bun run release:check
bun run cutover:check
bun run api:check
bun run lint
bun run typecheck
bun run typecheck:workspaces
bun run test
bun run build
bun run rust:fmt
bun run rust:clippy
bun run rust:test
```

Expected: all exit 0. Do not infer one command from another.

- [ ] **Step 2: Run environment-backed integration**

Run:

```powershell
bun run test:integration
bun run smoke:production
```

Expected: both exit 0 in isolated environments. If Docker is unavailable, capture the exact failure and leave production verification incomplete.

- [ ] **Step 3: Inspect the final branch**

Run:

```powershell
git status --short --branch
git log --oneline --decorate -5
git diff rust-dev...HEAD --check
```

Expected: worktree clean; commits are independently scoped; no whitespace errors.

- [ ] **Step 4: Perform remote acceptance only when authentication is valid**

Verify authentication, push the branch, open a pull request, and wait for the exact PR commit's reusable `Verify` workflow. Inspect the actual status-check context names produced by the reusable caller; if `main` branch protection still requires obsolete pre-refactor names, replace them with the observed `Verify` contexts without weakening the required-check set. If authentication remains invalid, report the branch as locally complete but remotely unverified; do not create a release tag as a substitute test.
