# deploy-core Step 1：静态产物解压、检测、Manifest 与 Hash 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `packages/deploy-core` as a pure processing library that can safely unzip, detect, generate manifest, and compute release hash for static build artifacts.

**Architecture:** Pipeline of focused modules: `path.ts` (normalization/security) → `unzip.ts` (safe extraction) → `root.ts` (artifact root detection) → `detect.ts` (risk analysis) → `manifest.ts`/`hash.ts` (content addressing) → `index.ts` (orchestration). Each module is independently testable. No API, database, or HTTP dependencies.

**Tech Stack:** Bun, TypeScript, yauzl (zip reading), Node.js built-in crypto (SHA-256)

## Global Constraints

- All error codes must be stable strings (never user-facing text)
- File content must never be fully held in memory — stream-based processing required
- Paths use forward slash normalization
- Zip entries must be processed with yauzl `lazyEntries` mode (streaming)
- All new files under `packages/deploy-core/`
- Existing `isValidProjectSlug` export must be preserved
- Every task ends with `git commit` + `codegraph sync` and tests passing
- Each `FileEntry` uses `absPath` (disk path), not `content` (buffer)
- Detection only reports — never modifies artifacts

---

## File Map

| File | Responsibility |
|------|---------------|
| `packages/deploy-core/package.json` | Add yauzl dependency |
| `packages/deploy-core/src/types.ts` | All interfaces (FileEntry, DetectItem, DetectResult, ManifestEntry, Manifest, ReleaseResult, ProcessReleaseOptions, ReleaseLimits) |
| `packages/deploy-core/src/errors.ts` | DeployCoreError class + error codes enum |
| `packages/deploy-core/src/limits.ts` | DEFAULT_RELEASE_LIMITS constant |
| `packages/deploy-core/src/path.ts` | normalizeZipEntryPath — comprehensive path security |
| `packages/deploy-core/src/unzip.ts` | safeExtractZip — yauzl-based streaming extraction |
| `packages/deploy-core/src/root.ts` | resolveArtifactRoot — detect single top-level dist/ dir |
| `packages/deploy-core/src/detect.ts` | runDetection — security + content risk analysis |
| `packages/deploy-core/src/hash.ts` | hashFile, deriveReleaseHash — SHA-256 utilities |
| `packages/deploy-core/src/manifest.ts` | buildManifest — sorted manifest with content-addressed hashes |
| `packages/deploy-core/src/index.ts` | processRelease pipeline + re-export isValidProjectSlug |
| `packages/deploy-core/tests/unit/path.test.ts` | Path normalization tests |
| `packages/deploy-core/tests/unit/unzip.test.ts` | Zip extraction tests |
| `packages/deploy-core/tests/unit/root.test.ts` | Root directory detection tests |
| `packages/deploy-core/tests/unit/detect.test.ts` | Detection logic tests |
| `packages/deploy-core/tests/unit/manifest.test.ts` | Manifest + hash tests |
| `packages/deploy-core/tests/fixtures/scripts/generate-fixtures.ts` | Test fixture zip generator |

---

### Task 1: Project Scaffold + Fixture Generation

**Files:**
- Modify: `packages/deploy-core/package.json`
- Create: `packages/deploy-core/tests/fixtures/scripts/generate-fixtures.ts`
- Create: `packages/deploy-core/tests/unit/.gitkeep`
- Create: `packages/deploy-core/tests/fixtures/.gitkeep`

**Interfaces:**
- Consumes: nothing (baseline setup)
- Produces: runnable `bun test` environment, 23 fixture zip files

- [ ] **Step 1: Update package.json with yauzl dependency**

```json
{
  "name": "@zipship/deploy-core",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "typecheck": "tsc -p tsconfig.json",
    "test": "bun test tests"
  },
  "dependencies": {
    "yauzl": "catalog:"
  },
  "devDependencies": {
    "@types/yauzl": "catalog:",
    "typescript": "catalog:"
  }
}
```

- [ ] **Step 2: Add yauzl to root catalog**

Edit `package.json` (root), add to `catalog`:
```json
"yauzl": "^3.2.0",
"@types/yauzl": "^3.2.0"
```

- [ ] **Step 3: Create directories**

```bash
mkdir -p packages/deploy-core/tests/unit
mkdir -p packages/deploy-core/tests/fixtures/scripts
touch packages/deploy-core/tests/unit/.gitkeep
touch packages/deploy-core/tests/fixtures/.gitkeep
```

- [ ] **Step 4: Install dependencies**

```bash
bun install
```

Expected: yauzl + @types/yauzl added to bun.lock.

- [ ] **Step 5: Create fixture generation script**

Create `packages/deploy-core/tests/fixtures/scripts/generate-fixtures.ts`:

```typescript
/**
 * Generate test fixture zip files for deploy-core unit tests.
 *
 * Creates temp directories with specific file structures, then zips them.
 * Only needs to be re-run when adding new fixtures.
 *
 * Usage: bun run packages/deploy-core/tests/fixtures/scripts/generate-fixtures.ts
 */

import { existsSync, mkdirSync, writeFileSync, cpSync, rmSync } from "fs";
import { join } from "path";
import { spawnSync } from "bun";

const FIXTURES_DIR = join(import.meta.dir, "..");
const TMP_DIR = join(FIXTURES_DIR, ".tmp-gen");

interface FixtureSpec {
  name: string;
  description: string;
  files: Record<string, string | Uint8Array>;
}

function ensureCleanTmp() {
  rmSync(TMP_DIR, { recursive: true, force: true });
  mkdirSync(TMP_DIR, { recursive: true });
}

function createFiles(baseDir: string, files: Record<string, string | Uint8Array>) {
  for (const [relPath, content] of Object.entries(files)) {
    const absPath = join(baseDir, relPath);
    mkdirSync(join(absPath, ".."), { recursive: true });
    if (typeof content === "string") {
      writeFileSync(absPath, content, "utf-8");
    } else {
      writeFileSync(absPath, content);
    }
  }
}

function createZipFixture(spec: FixtureSpec) {
  ensureCleanTmp();

  const contentDir = join(TMP_DIR, "content");
  mkdirSync(contentDir, { recursive: true });
  createFiles(contentDir, spec.files);

  const outputPath = join(FIXTURES_DIR, `${spec.name}.zip`);

  // Use system zip command
  const result = spawnSync(["zip", "-r", outputPath, "."], {
    cwd: contentDir,
    stdout: "pipe",
    stderr: "pipe",
  });

  if (result.exitCode !== 0) {
    console.error(`Failed to create ${spec.name}.zip:`, result.stderr.toString());
    process.exit(1);
  }

  console.log(`  ✓ ${spec.name}.zip (${Object.keys(spec.files).length} files)`);
  rmSync(TMP_DIR, { recursive: true, force: true });
}

const FIXTURES: FixtureSpec[] = [
  {
    name: "valid-vite-relative-base",
    description: "Normal Vite build with base: './' (relative paths)",
    files: {
      "index.html": `<script type="module" crossorigin src="./assets/index.js"></script><link rel="stylesheet" href="./assets/index.css">`,
      "assets/index.js": "console.log('hello');",
      "assets/index.css": "body { color: red; }",
      "assets/vendor.js": "// vendor chunk",
      "favicon.ico": "",
    },
  },
  {
    name: "valid-vite-root-base-warning",
    description: "Vite build with base: '/' (root paths — should warn)",
    files: {
      "index.html": `<script type="module" crossorigin src="/assets/index.js"></script><link rel="stylesheet" href="/assets/index.css">`,
      "assets/index.js": "console.log('hello');",
      "assets/index.css": "body { color: blue; }",
    },
  },
  {
    name: "nested-dist-folder",
    description: "Zip has a single top-level dist/ directory",
    files: {
      "dist/index.html": `<!DOCTYPE html><script src="./assets/index.js"></script>`,
      "dist/assets/index.js": "console.log('nested');",
      "dist/assets/index.css": "body { color: green; }",
    },
  },
  {
    name: "missing-index",
    description: "No index.html anywhere",
    files: {
      "assets/index.js": "console.log('no index');",
      "README.md": "# no index here",
    },
  },
  {
    name: "zip-slip",
    description: "Entry with ../ path traversal",
    files: {
      "index.html": "<h1>hello</h1>",
      "../evil.txt": "MALICIOUS",
    },
  },
  {
    name: "backslash-zip-slip",
    description: "Entry with backslash .. path traversal",
    files: {
      "index.html": "<h1>hello</h1>",
      "..\\evil.txt": "MALICIOUS",
    },
  },
  {
    name: "windows-drive-path",
    description: "Entry with Windows drive path",
    files: {
      "index.html": "<h1>hello</h1>",
    },
    // Note: This fixture is created separately since zip doesn't support C:\ paths
  },
  {
    name: "absolute-path",
    description: "Entry with absolute Unix path",
    files: {
      "index.html": "<h1>hello</h1>",
      "/etc/passwd": "root:x:0:0:root",
    },
  },
  {
    name: "symlink",
    description: "Contains a symlink entry (created via zip --symlinks)",
    files: {
      "index.html": "<h1>hello</h1>",
    },
  },
  {
    name: "service-worker",
    description: "Contains service-worker.js",
    files: {
      "index.html": `<script>navigator.serviceWorker.register('/sw.js')</script>`,
      "service-worker.js": "self.addEventListener('install', () => self.skipWaiting());",
      "assets/index.js": "console.log('sw');",
    },
  },
  {
    name: "sourcemap",
    description: "Contains .map files",
    files: {
      "index.html": `<script src="./assets/index.js"></script>`,
      "assets/index.js": "console.log('test');",
      "assets/index.js.map": '{"version":3,"sources":["index.ts"]}',
    },
  },
  {
    name: "dot-env",
    description: "Contains .env file",
    files: {
      "index.html": "<h1>hello</h1>",
      ".env": "SECRET_KEY=abc123",
      ".env.local": "API_KEY=xyz",
    },
  },
  {
    name: "secret-file",
    description: "Contains private key files",
    files: {
      "index.html": "<h1>hello</h1>",
      "private.pem": "-----BEGIN PRIVATE KEY-----",
      "id_rsa": "ssh-rsa AAAAB3NzaC1yc2E...",
    },
  },
  {
    name: "git-dir",
    description: "Contains .git/ directory",
    files: {
      "index.html": "<h1>hello</h1>",
      ".git/config": "[core]\n\trepositoryformatversion = 0",
      ".git/HEAD": "ref: refs/heads/main",
    },
  },
  {
    name: "css-root-url",
    description: "CSS with url('/assets/...') root references",
    files: {
      "index.html": `<link rel="stylesheet" href="./assets/style.css">`,
      "assets/style.css": `@font-face { src: url('/assets/font.woff2'); }\nbody { background: url('/assets/bg.png'); }`,
      "assets/font.woff2": "fake-font-data",
    },
  },
  {
    name: "reserved-api-path",
    description: "HTML references platform reserved paths",
    files: {
      "index.html": `<script src="/_api/auth/me"></script>`,
      "assets/index.js": "console.log('test');",
    },
  },
  {
    name: "single-quote-root-asset",
    description: "Single-quoted root asset references",
    files: {
      "index.html": `<script src='/assets/index.js'></script><link href='/assets/style.css'>`,
      "assets/index.js": "console.log('single');",
      "assets/style.css": "body { margin: 0; }",
    },
  },
  {
    name: "zero-byte-file",
    description: "Contains an empty file",
    files: {
      "index.html": "<h1>zero</h1>",
      "assets/empty.js": "",
    },
  },
  {
    name: "exact-limit-size",
    description: "Files that just barely fit within limits (used for boundary tests)",
    files: {
      "index.html": "<h1>boundary</h1>",
      "assets/big.js": "x".repeat(1024), // 1KB, well below limits
    },
  },
];

// Special fixtures that need manual binary construction
function createSpecialFixtures() {
  // too-many-files: 10001 empty files
  const tooManyDir = join(TMP_DIR, "too-many");
  rmSync(tooManyDir, { recursive: true, force: true });
  mkdirSync(tooManyDir, { recursive: true });
  writeFileSync(join(tooManyDir, "index.html"), "<h1>too many</h1>");
  for (let i = 0; i < 10001; i++) {
    writeFileSync(join(tooManyDir, `file${i}.js`), "");
  }
  const result = spawnSync(["zip", "-r", join(FIXTURES_DIR, "too-many-files.zip"), "."], {
    cwd: tooManyDir,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode === 0) console.log("  ✓ too-many-files.zip (10002 files)");
  rmSync(tooManyDir, { recursive: true, force: true });

  // large-file: single file > 100MB (create a sparse-like file using dd or truncate)
  const largeDir = join(TMP_DIR, "large");
  mkdirSync(largeDir, { recursive: true });
  writeFileSync(join(largeDir, "index.html"), "<h1>large</h1>");
  // Create a 101MB file — use truncate for speed on macOS/Linux
  const largeFile = join(largeDir, "huge.bin");
  const ddResult = spawnSync(["dd", "if=/dev/zero", `of=${largeFile}`, "bs=1M", "count=101"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  if (ddResult.exitCode !== 0) {
    // Fallback: write smaller sequential chunks
    const chunk = Buffer.alloc(1024 * 1024, 0); // 1MB
    const fd = Bun.file(largeFile).writer();
    for (let i = 0; i < 101; i++) fd.write(chunk);
    fd.end();
  }
  const largeZip = spawnSync(["zip", "-r", join(FIXTURES_DIR, "large-file.zip"), "."], {
    cwd: largeDir,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (largeZip.exitCode === 0) console.log("  ✓ large-file.zip (101MB file inside)");
  rmSync(largeDir, { recursive: true, force: true });
}

// over-limit-size: uncompressed size just over limit
function createOverLimitFixture() {
  const dir = join(TMP_DIR, "over-limit");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "index.html"), "<h1>over</h1>");
  // Create 513MB file (over 512MB limit)
  const bigFile = join(dir, "big.bin");
  const ddResult = spawnSync(["dd", "if=/dev/zero", `of=${bigFile}`, "bs=1M", "count=513"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  if (ddResult.exitCode === 0) {
    const result = spawnSync(["zip", "-r", join(FIXTURES_DIR, "over-limit-size.zip"), "."], {
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    });
    if (result.exitCode === 0) console.log("  ✓ over-limit-size.zip (513MB file)");
  }
  rmSync(dir, { recursive: true, force: true });
}

// empty.zip: a truly empty zip
function createEmptyZip() {
  // Empty zip minimal bytes
  const emptyZip = Buffer.from([
    0x50, 0x4b, 0x05, 0x06, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  ]);
  writeFileSync(join(FIXTURES_DIR, "empty.zip"), emptyZip);
  console.log("  ✓ empty.zip (empty central directory)");
}

// duplicate-path: normalized paths that collide
function createDuplicatePathFixture() {
  // Need to manually create: zip with ./assets/index.js AND assets//index.js
  // Using zip command won't easily do this. Create via Node.
  const dir = join(TMP_DIR, "duplicate");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "index.html"), "<h1>duplicate</h1>");
  // These will have different raw paths but normalize to same
  // Since zip normalizes, we need a different approach
  // For now, create the fixture by constructing zip bytes manually
  console.log("  - duplicate-path.zip: needs manual construction (see test)");
  rmSync(dir, { recursive: true, force: true });
}

// windows-drive-path: also manual
function createWindowsDriveFixture() {
  console.log("  - windows-drive-path.zip: needs manual construction (see test)");
}

console.log("Generating deploy-core test fixtures...\n");

for (const spec of FIXTURES) {
  // Skip special cases that need manual construction
  if (spec.name === "windows-drive-path" || spec.name === "duplicate-path") continue;

  // For absolute-path: zip command will fail on absolute paths, handle specially
  if (spec.name === "absolute-path") {
    ensureCleanTmp();
    const dir = join(TMP_DIR, "abs");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "index.html"), "<h1>hello</h1>");
    // Create a zip, then manually add the absolute path entry
    const zipPath = join(FIXTURES_DIR, "absolute-path.zip");
    const result = spawnSync(["zip", "-r", zipPath, "."], { cwd: dir, stdout: "pipe", stderr: "pipe" });
    if (result.exitCode === 0) console.log("  ✓ absolute-path.zip (note: /etc/passwd entry tested separately)");
    else console.error("  ✗ absolute-path.zip failed");
    rmSync(dir, { recursive: true, force: true });
    continue;
  }

  // For symlink: create actual symlink, then zip with --symlinks
  if (spec.name === "symlink") {
    ensureCleanTmp();
    const dir = join(TMP_DIR, "sym");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "index.html"), "<h1>symlink</h1>");
    writeFileSync(join(dir, "target.txt"), "real file");
    // Create symlink (fails on Windows, but that's ok)
    try {
      const symResult = spawnSync(["ln", "-s", "target.txt", join(dir, "link.txt")], {
        stdout: "pipe",
        stderr: "pipe",
      });
      if (symResult.exitCode === 0) {
        const zipResult = spawnSync(["zip", "--symlinks", "-r", join(FIXTURES_DIR, "symlink.zip"), "."], {
          cwd: dir,
          stdout: "pipe",
          stderr: "pipe",
        });
        if (zipResult.exitCode === 0) console.log("  ✓ symlink.zip");
      }
    } catch {
      console.log("  - symlink.zip: skipped (symlinks not supported on this platform)");
    }
    rmSync(dir, { recursive: true, force: true });
    continue;
  }

  // For backslash-zip-slip: same issue, zip normalizes paths
  if (spec.name === "backslash-zip-slip") {
    console.log("  - backslash-zip-slip.zip: tested via path.ts normalization");
    continue;
  }

  createZipFixture(spec);
}

createSpecialFixtures();
createOverLimitFixture();
createEmptyZip();
createDuplicatePathFixture();
createWindowsDriveFixture();

rmSync(TMP_DIR, { recursive: true, force: true });
console.log("\nDone. Run fixtures with: bun test packages/deploy-core/tests");
```

- [ ] **Step 6: Run the fixture generator**

```bash
bun run packages/deploy-core/tests/fixtures/scripts/generate-fixtures.ts
```

Expected output: Fixture zip files created in `packages/deploy-core/tests/fixtures/`.

- [ ] **Step 7: Commit**

```bash
git add packages/deploy-core/
git commit -m "chore: scaffold deploy-core package with yauzl and test fixtures

- Add yauzl dependency for safe zip reading
- Create directory structure for tests
- Add fixture generation script with 23 test zip specs
- Generate fixture zip files for unit tests

Co-Authored-By: Claude <noreply@anthropic.com>"
codegraph sync
```

---

### Task 2: Types, Errors, and Limits

**Files:**
- Create: `packages/deploy-core/src/types.ts`
- Create: `packages/deploy-core/src/errors.ts`
- Create: `packages/deploy-core/src/limits.ts`

**Interfaces:**
- Consumes: nothing (standalone type definitions)
- Produces: types used by all subsequent modules

- [ ] **Step 1: Create types.ts**

```typescript
// packages/deploy-core/src/types.ts

export interface ReleaseLimits {
  maxFiles: number;
  maxSingleFileSize: number;
  maxTotalUncompressedSize: number;
  maxIndexHtmlAnalyzeSize: number;
  maxCssAnalyzeSize: number;
}

export interface FileEntry {
  path: string;
  absPath: string;
  size: number;
  hash?: string;
}

export interface DetectItem {
  level: "info" | "warning" | "failed";
  code: string;
  details?: Record<string, unknown>;
}

export interface DetectResult {
  level: "pass" | "warning" | "failed";
  items: DetectItem[];
}

export interface ManifestEntry {
  path: string;
  hash: string;
  size: number;
}

export interface Manifest {
  version: number;
  hashAlgorithm: string;
  files: ManifestEntry[];
  hash: string;
  releaseHash: string;
}

export interface ReleaseResult {
  rootDir: string;
  files: FileEntry[];
  detect: DetectResult;
  manifest: Manifest;
}

export type DetectMode = "auto" | "vite" | "static";

export interface ProcessReleaseOptions {
  zipPath: string;
  workDir: string;
  limits?: Partial<ReleaseLimits>;
  detectMode?: DetectMode;
}
```

- [ ] **Step 2: Create errors.ts**

```typescript
// packages/deploy-core/src/errors.ts

export const DEPLOY_CORE_ERROR_CODES = {
  ZIP_OPEN_FAILED: "ZIP_OPEN_FAILED",
  ZIP_ENTRY_PATH_TRAVERSAL: "ZIP_ENTRY_PATH_TRAVERSAL",
  ZIP_ENTRY_ABSOLUTE_PATH: "ZIP_ENTRY_ABSOLUTE_PATH",
  ZIP_ENTRY_WINDOWS_DRIVE_PATH: "ZIP_ENTRY_WINDOWS_DRIVE_PATH",
  ZIP_ENTRY_NUL_BYTE: "ZIP_ENTRY_NUL_BYTE",
  ZIP_ENTRY_UNSUPPORTED_TYPE: "ZIP_ENTRY_UNSUPPORTED_TYPE",
  ZIP_ENTRY_SYMLINK: "ZIP_ENTRY_SYMLINK",
  ZIP_ENTRY_DUPLICATE_PATH: "ZIP_ENTRY_DUPLICATE_PATH",
  ZIP_TOO_MANY_FILES: "ZIP_TOO_MANY_FILES",
  ZIP_SINGLE_FILE_TOO_LARGE: "ZIP_SINGLE_FILE_TOO_LARGE",
  ZIP_TOTAL_SIZE_TOO_LARGE: "ZIP_TOTAL_SIZE_TOO_LARGE",
  ZIP_EXTRACT_FAILED: "ZIP_EXTRACT_FAILED",
  MANIFEST_HASH_FAILED: "MANIFEST_HASH_FAILED",
} as const;

export type DeployCoreErrorCode = (typeof DEPLOY_CORE_ERROR_CODES)[keyof typeof DEPLOY_CORE_ERROR_CODES];

export class DeployCoreError extends Error {
  constructor(
    public code: string,
    public details?: Record<string, unknown>,
  ) {
    super(code);
    this.name = "DeployCoreError";
  }
}
```

- [ ] **Step 3: Create limits.ts**

```typescript
// packages/deploy-core/src/limits.ts

import type { ReleaseLimits } from "./types";

export const DEFAULT_RELEASE_LIMITS: ReleaseLimits = {
  maxFiles: 10_000,
  maxSingleFileSize: 100 * 1024 * 1024,
  maxTotalUncompressedSize: 512 * 1024 * 1024,
  maxIndexHtmlAnalyzeSize: 512 * 1024,
  maxCssAnalyzeSize: 1 * 1024 * 1024,
};

export function resolveReleaseLimits(partial?: Partial<ReleaseLimits>): ReleaseLimits {
  if (!partial) return { ...DEFAULT_RELEASE_LIMITS };
  return {
    maxFiles: partial.maxFiles ?? DEFAULT_RELEASE_LIMITS.maxFiles,
    maxSingleFileSize: partial.maxSingleFileSize ?? DEFAULT_RELEASE_LIMITS.maxSingleFileSize,
    maxTotalUncompressedSize: partial.maxTotalUncompressedSize ?? DEFAULT_RELEASE_LIMITS.maxTotalUncompressedSize,
    maxIndexHtmlAnalyzeSize: partial.maxIndexHtmlAnalyzeSize ?? DEFAULT_RELEASE_LIMITS.maxIndexHtmlAnalyzeSize,
    maxCssAnalyzeSize: partial.maxCssAnalyzeSize ?? DEFAULT_RELEASE_LIMITS.maxCssAnalyzeSize,
  };
}
```

- [ ] **Step 4: Verify types compile**

```bash
bun run --filter @zipship/deploy-core typecheck
```

Expected: No type errors.

- [ ] **Step 5: Commit**

```bash
git add packages/deploy-core/src/types.ts packages/deploy-core/src/errors.ts packages/deploy-core/src/limits.ts
git commit -m "feat(deploy-core): add core types, error class, and limit defaults

- Define FileEntry, DetectItem, DetectResult, Manifest, ReleaseResult interfaces
- Add DeployCoreError class with stable error code constants
- Add DEFAULT_RELEASE_LIMITS with configurable limits
- Add resolveReleaseLimits helper for merging partial configs

Co-Authored-By: Claude <noreply@anthropic.com>"
codegraph sync
```

---

### Task 3: Path Security (path.ts)

**Files:**
- Create: `packages/deploy-core/src/path.ts`
- Create: `packages/deploy-core/tests/unit/path.test.ts`

**Interfaces:**
- Consumes: `DeployCoreError` from errors.ts
- Produces: `normalizeZipEntryPath(entryName: string): string` — used by unzip.ts

- [ ] **Step 1: Write the failing test**

```typescript
// packages/deploy-core/tests/unit/path.test.ts

import { describe, expect, test } from "bun:test";
import { normalizeZipEntryPath } from "../../src/path";

describe("normalizeZipEntryPath", () => {
  describe("valid paths pass through", () => {
    test("simple file path", () => {
      expect(normalizeZipEntryPath("index.html")).toBe("index.html");
    });

    test("nested directory path", () => {
      expect(normalizeZipEntryPath("assets/index.js")).toBe("assets/index.js");
    });

    test("deeply nested path", () => {
      expect(normalizeZipEntryPath("assets/css/style.css")).toBe("assets/css/style.css");
    });

    test("leading ./ is removed", () => {
      expect(normalizeZipEntryPath("./assets/index.js")).toBe("assets/index.js");
    });

    test("backslash normalized to forward slash", () => {
      expect(normalizeZipEntryPath("assets\\index.js")).toBe("assets/index.js");
    });
  });

  describe("dangerous paths are rejected", () => {
    test("rejects path traversal with ../", () => {
      expect(() => normalizeZipEntryPath("../evil.txt")).toThrow();
    });

    test("rejects deeply nested path traversal", () => {
      expect(() => normalizeZipEntryPath("assets/../../evil.txt")).toThrow();
    });

    test("rejects backslash path traversal", () => {
      expect(() => normalizeZipEntryPath("..\\evil.txt")).toThrow();
    });

    test("rejects absolute Unix path", () => {
      expect(() => normalizeZipEntryPath("/etc/passwd")).toThrow();
    });

    test("rejects Windows drive path (C:)", () => {
      expect(() => normalizeZipEntryPath("C:\\Windows\\system.ini")).toThrow();
    });

    test("rejects Windows drive path forward slash (C:/)", () => {
      expect(() => normalizeZipEntryPath("C:/Windows/system.ini")).toThrow();
    });

    test("rejects path with NUL byte", () => {
      expect(() => normalizeZipEntryPath("file\0name.txt")).toThrow();
    });

    test("rejects empty path", () => {
      expect(() => normalizeZipEntryPath("")).toThrow();
    });

    test("rejects //server/share paths", () => {
      expect(() => normalizeZipEntryPath("//server/share/file.txt")).toThrow();
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test packages/deploy-core/tests/unit/path.test.ts
```

Expected: FAIL — `normalizeZipEntryPath` not found.

- [ ] **Step 3: Write minimal implementation**

```typescript
// packages/deploy-core/src/path.ts

import { DeployCoreError, DEPLOY_CORE_ERROR_CODES } from "./errors";

const WINDOWS_DRIVE_PATH = /^[a-zA-Z]:[/\\]/;
const NUL_BYTE = /\0/;

/**
 * Normalize and validate a zip entry path.
 *
 * Rules:
 * 1. Replace backslashes with forward slashes
 * 2. Reject empty paths
 * 3. Reject NUL byte
 * 4. Reject absolute paths (starting with /)
 * 5. Reject //server/share paths
 * 6. Reject Windows drive paths (C:\...)
 * 7. Reject any .. path segments
 * 8. Remove leading ./
 * 9. Collapse duplicate /
 * 10. Decode percent-encoded characters
 */
export function normalizeZipEntryPath(entryName: string): string {
  if (!entryName) {
    throw new DeployCoreError(DEPLOY_CORE_ERROR_CODES.ZIP_ENTRY_NUL_BYTE, { entryName });
  }

  if (NUL_BYTE.test(entryName)) {
    throw new DeployCoreError(DEPLOY_CORE_ERROR_CODES.ZIP_ENTRY_NUL_BYTE, { entryName });
  }

  // Normalize backslashes
  let normalized = entryName.replace(/\\/g, "/");

  // Decode percent-encoded characters (except for when it's actually a %)
  try {
    normalized = decodeURIComponent(normalized);
  } catch {
    // If decoding fails, use the original normalized string
  }

  // Reject absolute Unix paths
  if (normalized.startsWith("/")) {
    throw new DeployCoreError(DEPLOY_CORE_ERROR_CODES.ZIP_ENTRY_ABSOLUTE_PATH, { entryName, normalized });
  }

  // Reject //server/share paths
  if (normalized.startsWith("//")) {
    throw new DeployCoreError(DEPLOY_CORE_ERROR_CODES.ZIP_ENTRY_ABSOLUTE_PATH, { entryName, normalized });
  }

  // Reject Windows drive paths
  if (WINDOWS_DRIVE_PATH.test(normalized)) {
    throw new DeployCoreError(DEPLOY_CORE_ERROR_CODES.ZIP_ENTRY_WINDOWS_DRIVE_PATH, { entryName, normalized });
  }

  // Collapse duplicate slashes
  normalized = normalized.replace(/\/+/g, "/");

  // Remove leading ./
  normalized = normalized.replace(/^\.\//, "");

  // Reject any path traversal (.. segments)
  const segments = normalized.split("/");
  for (const segment of segments) {
    if (segment === "..") {
      throw new DeployCoreError(DEPLOY_CORE_ERROR_CODES.ZIP_ENTRY_PATH_TRAVERSAL, { entryName, normalized });
    }
  }

  return normalized;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
bun test packages/deploy-core/tests/unit/path.test.ts
```

Expected: 12 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/deploy-core/src/path.ts packages/deploy-core/tests/unit/path.test.ts
git commit -m "feat(deploy-core): add path normalization with security validation

- Implement normalizeZipEntryPath with comprehensive security rules
- Reject path traversal, absolute paths, Windows drive paths, NUL bytes
- Normalize backslashes, leading ./, and duplicate slashes
- 12 unit tests covering valid and dangerous paths

Co-Authored-By: Claude <noreply@anthropic.com>"
codegraph sync

---

### Task 4: Safe Zip Extraction (unzip.ts)

**Files:**
- Create: `packages/deploy-core/src/unzip.ts`
- Create: `packages/deploy-core/tests/unit/unzip.test.ts`

**Interfaces:**
- Consumes: `normalizeZipEntryPath` (path.ts), `FileEntry` (types.ts), `DeployCoreError` (errors.ts), `resolveReleaseLimits` + `DEFAULT_RELEASE_LIMITS` (limits.ts)
- Produces: `safeExtractZip(zipPath, workDir, limits): Promise<FileEntry[]>`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/deploy-core/tests/unit/unzip.test.ts

import { describe, expect, test, beforeAll } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { safeExtractZip } from "../../src/unzip";
import { DeployCoreError } from "../../src/errors";

const FIXTURES_DIR = join(import.meta.dir, "../fixtures");
const TMP_DIR = join(import.meta.dir, "../.tmp-unzip-test");

beforeAll(() => {
  rmSync(TMP_DIR, { recursive: true, force: true });
  mkdirSync(TMP_DIR, { recursive: true });
});

describe("safeExtractZip", () => {
  function runDir(name: string) {
    const dir = join(TMP_DIR, name);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  test("extracts a valid zip successfully", async () => {
    const result = await safeExtractZip(
      join(FIXTURES_DIR, "valid-vite-relative-base.zip"),
      runDir("valid"),
    );
    expect(result.length).toBeGreaterThan(0);
    expect(result.some((f) => f.path === "index.html")).toBe(true);
    expect(result.some((f) => f.path === "assets/index.js")).toBe(true);
    // Check that files actually exist on disk
    for (const entry of result) {
      expect(existsSync(entry.absPath)).toBe(true);
    }
  });

  test("rejects zip-slip path traversal", async () => {
    const dir = runDir("zip-slip");
    try {
      await safeExtractZip(join(FIXTURES_DIR, "zip-slip.zip"), dir);
      expect.unreachable("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(DeployCoreError);
      expect((e as DeployCoreError).code).toBe("ZIP_ENTRY_PATH_TRAVERSAL");
    }
  });

  test("rejects absolute path", async () => {
    const dir = runDir("abs-path");
    try {
      await safeExtractZip(join(FIXTURES_DIR, "absolute-path.zip"), dir);
      expect.unreachable("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(DeployCoreError);
      expect((e as DeployCoreError).code).toBe("ZIP_ENTRY_ABSOLUTE_PATH");
    }
  });

  test("rejects symlink entries", async () => {
    const dir = runDir("symlink");
    // Only run if the fixture exists
    const zipPath = join(FIXTURES_DIR, "symlink.zip");
    if (!existsSync(zipPath)) return; // Skip on platforms without symlink support
    try {
      await safeExtractZip(zipPath, dir);
      expect.unreachable("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(DeployCoreError);
      expect((e as DeployCoreError).code).toBe("ZIP_ENTRY_SYMLINK");
    }
  });

  test("rejects too many files", async () => {
    const dir = runDir("too-many");
    const zipPath = join(FIXTURES_DIR, "too-many-files.zip");
    if (!existsSync(zipPath)) return;
    try {
      await safeExtractZip(zipPath, dir);
      expect.unreachable("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(DeployCoreError);
      expect((e as DeployCoreError).code).toBe("ZIP_TOO_MANY_FILES");
    }
  });

  test("rejects large single file", async () => {
    const dir = runDir("large");
    const zipPath = join(FIXTURES_DIR, "large-file.zip");
    if (!existsSync(zipPath)) return;
    try {
      await safeExtractZip(zipPath, dir);
      expect.unreachable("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(DeployCoreError);
      expect((e as DeployCoreError).code).toBe("ZIP_SINGLE_FILE_TOO_LARGE");
    }
  });

  test("handles empty zip", async () => {
    const dir = runDir("empty");
    await safeExtractZip(join(FIXTURES_DIR, "empty.zip"), dir);
    // Empty zip should just produce no files
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test packages/deploy-core/tests/unit/unzip.test.ts
```

Expected: FAIL — `safeExtractZip` not found.

- [ ] **Step 3: Write minimal implementation**

```typescript
// packages/deploy-core/src/unzip.ts

import { chmodSync, createWriteStream, existsSync, mkdirSync } from "fs";
import { join, resolve } from "path";
import yauzl from "yauzl";
import { normalizeZipEntryPath } from "./path";
import { DeployCoreError, DEPLOY_CORE_ERROR_CODES } from "./errors";
import { resolveReleaseLimits } from "./limits";
import type { FileEntry, ReleaseLimits } from "./types";

/**
 * Safely extract a zip file to a working directory.
 *
 * Uses yauzl lazyEntries mode to process entries one at a time,
 * validating each entry for security before writing to disk.
 */
export async function safeExtractZip(
  zipPath: string,
  workDir: string,
  limits?: Partial<ReleaseLimits>,
): Promise<FileEntry[]> {
  const resolvedLimits = resolveReleaseLimits(limits);
  const entries: FileEntry[] = [];
  const seenPaths = new Set<string>();
  let totalUncompressedSize = 0;

  await new Promise<void>((resolvePromise, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zipfile) => {
      if (err) {
        reject(new DeployCoreError(DEPLOY_CORE_ERROR_CODES.ZIP_OPEN_FAILED, { zipPath, error: err.message }));
        return;
      }
      if (!zipfile) {
        reject(new DeployCoreError(DEPLOY_CORE_ERROR_CODES.ZIP_OPEN_FAILED, { zipPath }));
        return;
      }

      zipfile.readEntry();

      zipfile.on("entry", (entry: yauzl.Entry) => {
        try {
          // Normalize and validate the path
          const normalizedPath = normalizeZipEntryPath(entry.fileName);

          // Skip directory entries
          if (/\/$/.test(normalizedPath)) {
            mkdirSync(join(workDir, normalizedPath), { recursive: true });
            zipfile.readEntry();
            return;
          }

          // Check for duplicate normalized paths
          if (seenPaths.has(normalizedPath)) {
            reject(new DeployCoreError(DEPLOY_CORE_ERROR_CODES.ZIP_ENTRY_DUPLICATE_PATH, {
              fileName: entry.fileName,
              normalizedPath,
            }));
            return;
          }

          // Check file count
          if (entries.length >= resolvedLimits.maxFiles) {
            reject(new DeployCoreError(DEPLOY_CORE_ERROR_CODES.ZIP_TOO_MANY_FILES, {
              maxFiles: resolvedLimits.maxFiles,
            }));
            return;
          }

          // Check uncompressed size
          const uncompressedSize = Number(entry.uncompressedSize);
          totalUncompressedSize += uncompressedSize;

          if (totalUncompressedSize > resolvedLimits.maxTotalUncompressedSize) {
            reject(new DeployCoreError(DEPLOY_CORE_ERROR_CODES.ZIP_TOTAL_SIZE_TOO_LARGE, {
              maxTotal: resolvedLimits.maxTotalUncompressedSize,
              actual: totalUncompressedSize,
            }));
            return;
          }

          // Check single file size
          if (uncompressedSize > resolvedLimits.maxSingleFileSize) {
            reject(new DeployCoreError(DEPLOY_CORE_ERROR_CODES.ZIP_SINGLE_FILE_TOO_LARGE, {
              fileName: entry.fileName,
              size: uncompressedSize,
              maxSize: resolvedLimits.maxSingleFileSize,
            }));
            return;
          }

          // External file attributes: check if symlink (Unix symlink = 0o120000 mask)
          const externalAttr = entry.externalFileAttributes;
          const isUnixSymlink = (externalAttr !== undefined) && ((externalAttr >>> 16) & 0o170000) === 0o120000;
          if (isUnixSymlink) {
            reject(new DeployCoreError(DEPLOY_CORE_ERROR_CODES.ZIP_ENTRY_SYMLINK, {
              fileName: entry.fileName,
            }));
            return;
          }

          seenPaths.add(normalizedPath);

          // Open read stream for this entry
          zipfile.openReadStream(entry, (readErr, readStream) => {
            if (readErr || !readStream) {
              reject(new DeployCoreError(DEPLOY_CORE_ERROR_CODES.ZIP_EXTRACT_FAILED, {
                fileName: entry.fileName,
                error: readErr?.message,
              }));
              return;
            }

            const targetDir = resolve(workDir, normalizedPath);
            // Verify the resolved path is within workDir
            if (!targetDir.startsWith(resolve(workDir))) {
              reject(new DeployCoreError(DEPLOY_CORE_ERROR_CODES.ZIP_ENTRY_PATH_TRAVERSAL, {
                fileName: entry.fileName,
                normalizedPath,
              }));
              return;
            }

            mkdirSync(join(targetDir, ".."), { recursive: true });

            const writeStream = createWriteStream(targetDir);

            readStream.pipe(writeStream);

            writeStream.on("finish", () => {
              // Set secure file permissions — don't inherit zip entry's Unix bits
              chmodSync(targetDir, 0o644);
              entries.push({
                path: normalizedPath,
                absPath: targetDir,
                size: uncompressedSize,
              });
              zipfile.readEntry();
            });

            writeStream.on("error", (writeErr) => {
              reject(new DeployCoreError(DEPLOY_CORE_ERROR_CODES.ZIP_EXTRACT_FAILED, {
                fileName: entry.fileName,
                error: writeErr.message,
              }));
            });
          });
        } catch (normalizeErr) {
          if (normalizeErr instanceof DeployCoreError) {
            reject(normalizeErr);
          } else {
            reject(new DeployCoreError(DEPLOY_CORE_ERROR_CODES.ZIP_EXTRACT_FAILED, {
              fileName: entry.fileName,
              error: String(normalizeErr),
            }));
          }
        }
      });

      zipfile.on("end", () => {
        resolvePromise();
      });

      zipfile.on("error", (zipErr) => {
        reject(new DeployCoreError(DEPLOY_CORE_ERROR_CODES.ZIP_EXTRACT_FAILED, {
          error: zipErr.message,
        }));
      });
    });
  });

  return entries;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
bun test packages/deploy-core/tests/unit/unzip.test.ts
```

Expected: Tests pass (some may be skipped if fixture files don't exist).

- [ ] **Step 5: Commit**

```bash
git add packages/deploy-core/src/unzip.ts packages/deploy-core/tests/unit/unzip.test.ts
git commit -m "feat(deploy-core): implement safe zip extraction with yauzl

- Add safeExtractZip using yauzl lazyEntries mode (streaming)
- Validate each entry: path security, file count, size limits, symlinks
- Track seen paths for duplicate detection
- Skip directory entries (only register regular files)
- 6 unit tests covering valid extraction, path traversal, symlinks, limits

Co-Authored-By: Claude <noreply@anthropic.com>"
codegraph sync

---

### Task 5: Artifact Root Detection (root.ts)

**Files:**
- Create: `packages/deploy-core/src/root.ts`
- Create: `packages/deploy-core/tests/unit/root.test.ts`

**Interfaces:**
- Consumes: `FileEntry` (types.ts)
- Produces: `resolveArtifactRoot(files, workDir): { rootDir: string; files: FileEntry[] }` — used by index.ts

- [ ] **Step 1: Write the failing test**

```typescript
// packages/deploy-core/tests/unit/root.test.ts

import { describe, expect, test } from "bun:test";
import { join } from "path";
import { resolveArtifactRoot } from "../../src/root";
import type { FileEntry } from "../../src/types";

describe("resolveArtifactRoot", () => {
  function makeEntry(relPath: string): FileEntry {
    return {
      path: relPath,
      absPath: "/tmp/work/" + relPath,
      size: 100,
    };
  }

  test("index.html at root → rootDir = workDir", () => {
    const workDir = "/tmp/work";
    const files = [
      makeEntry("index.html"),
      makeEntry("assets/index.js"),
    ];
    const result = resolveArtifactRoot(files, workDir);
    expect(result.rootDir).toBe(workDir);
    expect(result.files[0].path).toBe("index.html");
  });

  test("single top-level dir with index.html → resolves to that dir", () => {
    const workDir = "/tmp/work";
    const files = [
      makeEntry("dist/index.html"),
      makeEntry("dist/assets/index.js"),
    ];
    const result = resolveArtifactRoot(files, workDir);
    expect(result.rootDir).toBe(join(workDir, "dist"));
    expect(result.files[0].path).toBe("index.html"); // re-rooted
    expect(result.files[1].path).toBe("assets/index.js"); // re-rooted
  });

  test("nested two levels deep → resolves to deepest with index.html", () => {
    const workDir = "/tmp/work";
    const files = [
      makeEntry("build/dist/index.html"),
      makeEntry("build/dist/assets/index.js"),
    ];
    const result = resolveArtifactRoot(files, workDir);
    expect(result.rootDir).toBe(join(workDir, "build/dist"));
    expect(result.files[0].path).toBe("index.html");
    expect(result.files[1].path).toBe("assets/index.js");
  });

  test("no index.html anywhere → returns workDir unchanged", () => {
    const workDir = "/tmp/work";
    const files = [
      makeEntry("README.md"),
      makeEntry("assets/index.js"),
    ];
    const result = resolveArtifactRoot(files, workDir);
    expect(result.rootDir).toBe(workDir);
    // Paths unchanged
    expect(result.files[0].path).toBe("README.md");
  });

  test("multiple top-level dirs, no root index.html → returns workDir unchanged", () => {
    const workDir = "/tmp/work";
    const files = [
      makeEntry("dist1/index.html"),
      makeEntry("dist2/index.html"),
    ];
    const result = resolveArtifactRoot(files, workDir);
    expect(result.rootDir).toBe(workDir);
    expect(result.files[0].path).toBe("dist1/index.html");
  });

  test("empty files array returns workDir unchanged", () => {
    const result = resolveArtifactRoot([], "/tmp/work");
    expect(result.rootDir).toBe("/tmp/work");
    expect(result.files).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test packages/deploy-core/tests/unit/root.test.ts
```

Expected: FAIL — `resolveArtifactRoot` not found.

- [ ] **Step 3: Write minimal implementation**

```typescript
// packages/deploy-core/src/root.ts

import { join } from "path";
import type { FileEntry } from "./types";

interface RootResult {
  rootDir: string;
  files: FileEntry[];
}

/**
 * Detect the actual artifact root directory.
 *
 * Many users zip with a single top-level directory (e.g., dist/).
 * This function detects that case and re-roots paths accordingly.
 */
export function resolveArtifactRoot(files: FileEntry[], workDir: string): RootResult {
  if (files.length === 0) {
    return { rootDir: workDir, files: [] };
  }

  // Check if index.html exists at root
  const hasRootIndex = files.some((f) => f.path === "index.html");
  if (hasRootIndex) {
    return { rootDir: workDir, files };
  }

  // Find all top-level directories
  const topLevelDirs = new Set<string>();
  for (const f of files) {
    const firstSlash = f.path.indexOf("/");
    if (firstSlash > 0) {
      topLevelDirs.add(f.path.slice(0, firstSlash));
    }
  }

  // If exactly one top-level dir, check if it contains index.html
  if (topLevelDirs.size === 1) {
    const topDir = [...topLevelDirs][0];
    const prefix = topDir + "/";
    const dirFiles = files.filter((f) => f.path.startsWith(prefix));

    if (dirFiles.some((f) => f.path === prefix + "index.html")) {
      // Re-root: strip the top-level directory from paths
      const reRootedFiles = dirFiles.map((f) => ({
        ...f,
        path: f.path.slice(prefix.length),
      }));
      return { rootDir: join(workDir, topDir), files: reRootedFiles };
    }

    // Try recursive descent: single dir all the way down
    const nestedFiles = files.filter((f) => f.path.startsWith(prefix));
    if (nestedFiles.length === files.length) {
      const deeper = resolveArtifactRoot(
        nestedFiles.map((f) => ({ ...f, path: f.path.slice(prefix.length) })),
        join(workDir, topDir),
      );
      if (deeper.rootDir !== join(workDir, topDir) || nestedFiles.some((f) => f.path === prefix + "index.html")) {
        return deeper;
      }
    }
  }

  // Cannot determine root — return workDir unchanged
  return { rootDir: workDir, files };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
bun test packages/deploy-core/tests/unit/root.test.ts
```

Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/deploy-core/src/root.ts packages/deploy-core/tests/unit/root.test.ts
git commit -m "feat(deploy-core): add artifact root directory detection

- Implement resolveArtifactRoot to handle dist/ nested directory pattern
- Single top-level dir with index.html gets re-rooted automatically
- No index.html anywhere or multiple top-level dirs → workDir unchanged
- Recursive descent for deeply nested single directories
- 6 unit tests covering root, nested, multi-dir, and empty cases

Co-Authored-By: Claude <noreply@anthropic.com>"
codegraph sync

---

### Task 6: Detection (detect.ts)

**Files:**
- Create: `packages/deploy-core/src/detect.ts`
- Create: `packages/deploy-core/tests/unit/detect.test.ts`

**Interfaces:**
- Consumes: `FileEntry`, `DetectItem`, `DetectResult`, `DetectMode` (types.ts)
- Produces: `runDetection(files, options?): Promise<DetectResult>`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/deploy-core/tests/unit/detect.test.ts

import { describe, expect, test } from "bun:test";
import { join } from "path";
import { runDetection } from "../../src/detect";
import type { FileEntry } from "../../src/types";

function makeFile(relPath: string, content?: string): FileEntry {
  return {
    path: relPath,
    absPath: join("/tmp/test", relPath),
    size: content ? Buffer.byteLength(content) : 100,
    hash: undefined,
  };
}

describe("runDetection", () => {
  test("normal Vite relative paths → pass", async () => {
    const files = [
      makeFile("index.html", '<script src="./assets/index.js"></script>'),
      makeFile("assets/index.js", "console.log('ok');"),
    ];
    const result = await runDetection(files);
    expect(result.level).toBe("pass");
  });

  test("missing index.html → failed", async () => {
    const files = [makeFile("README.md", "# hello")];
    const result = await runDetection(files);
    expect(result.level).toBe("failed");
    expect(result.items.some((i) => i.code === "MISSING_INDEX_HTML")).toBe(true);
  });

  test("root path /assets reference → warning", async () => {
    const files = [
      makeFile("index.html", '<script src="/assets/index.js"></script>'),
      makeFile("assets/index.js", ""),
    ];
    const result = await runDetection(files);
    expect(result.items.some((i) => i.code === "ROOT_ASSET_PATH_DETECTED")).toBe(true);
    expect(result.level).toBe("warning");
  });

  test("service-worker.js → warning", async () => {
    const files = [
      makeFile("index.html", "<h1>sw</h1>"),
      makeFile("service-worker.js", "self.addEventListener('install', () => {});"),
    ];
    const result = await runDetection(files);
    expect(result.items.some((i) => i.code === "SERVICE_WORKER_DETECTED")).toBe(true);
  });

  test("sourcemap files → warning", async () => {
    const files = [
      makeFile("index.html", "<h1>map</h1>"),
      makeFile("assets/index.js", "console.log('a');"),
      makeFile("assets/index.js.map", '{"version":3}'),
    ];
    const result = await runDetection(files);
    expect(result.items.some((i) => i.code === "SOURCE_MAP_DETECTED")).toBe(true);
  });

  test(".env files → failed", async () => {
    const files = [
      makeFile("index.html", "<h1>env</h1>"),
      makeFile(".env", "SECRET=abc"),
    ];
    const result = await runDetection(files);
    expect(result.level).toBe("failed");
    expect(result.items.some((i) => i.code === "ENV_FILE_DETECTED")).toBe(true);
  });

  test("secret key files → failed", async () => {
    const files = [
      makeFile("index.html", "<h1>secret</h1>"),
      makeFile("private.pem", "-----BEGIN PRIVATE KEY-----"),
    ];
    const result = await runDetection(files);
    expect(result.level).toBe("failed");
    expect(result.items.some((i) => i.code === "SECRET_FILE_DETECTED")).toBe(true);
  });

  test(".git directory → failed", async () => {
    const files = [
      makeFile("index.html", "<h1>git</h1>"),
      makeFile(".git/config", "[core]"),
    ];
    const result = await runDetection(files);
    expect(result.level).toBe("failed");
    expect(result.items.some((i) => i.code === "GIT_DIR_DETECTED")).toBe(true);
  });

  test("referenced assets dir missing → warning", async () => {
    const files = [
      makeFile("index.html", '<link rel="stylesheet" href="./assets/style.css"><script src="./assets/index.js"></script>'),
    ];
    const result = await runDetection(files);
    expect(result.items.some((i) => i.code === "REFERENCED_ASSETS_DIR_MISSING")).toBe(true);
    expect(result.level).toBe("warning");
  });

  test("CSS url('/assets/') root reference → warning", async () => {
    const files = [
      makeFile("index.html", '<link rel="stylesheet" href="./assets/style.css">'),
      makeFile("assets/style.css", "@font-face { src: url('/assets/font.woff2'); }"),
    ];
    const result = await runDetection(files);
    expect(result.items.some((i) => i.code === "ROOT_ASSET_PATH_DETECTED")).toBe(true);
  });

  test("reserved platform path reference → warning", async () => {
    const files = [
      makeFile("index.html", '<script src="/_api/auth/me"></script>'),
    ];
    const result = await runDetection(files);
    expect(result.items.some((i) => i.code === "RESERVED_PLATFORM_PATH_REFERENCED")).toBe(true);
  });

  test("system files → info level", async () => {
    const files = [
      makeFile("index.html", "<h1>system</h1>"),
      makeFile(".DS_Store", ""),
      makeFile("__MACOSX/._index.html", ""),
    ];
    const result = await runDetection(files);
    expect(result.items.some((i) => i.code === "SYSTEM_FILE_DETECTED")).toBe(true);
    // Info items should not affect overall level
    expect(result.level).toBe("pass");
  });

  test("zero-byte files should pass", async () => {
    const files = [
      makeFile("index.html", "<h1>zero</h1>"),
      makeFile("assets/empty.js", ""),
    ];
    const result = await runDetection(files);
    expect(result.level).toBe("pass");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test packages/deploy-core/tests/unit/detect.test.ts
```

Expected: FAIL — `runDetection` not found.

- [ ] **Step 3: Write minimal implementation**

```typescript
// packages/deploy-core/src/detect.ts

import { openSync, readSync, closeSync, readFileSync } from "fs";
import type { FileEntry, DetectItem, DetectResult, DetectMode } from "./types";

const SECRET_FILE_EXTENSIONS = [".pem", ".key", ".cert", ".p12", ".pfx", ".pkcs12"];
const SECRET_FILE_NAMES = ["id_rsa", "id_dsa", "id_ecdsa", "id_ed25519"];
const ENV_FILE_PATTERNS = [/^\.env/, /^\.env\.\w+/];
const RESERVED_PLATFORM_PATHS = ["/_api", "/_console", "/_health", "/_assets"];

function scanForRisks(files: FileEntry[]): DetectItem[] {
  const items: DetectItem[] = [];
  const fileSet = new Set(files.map((f) => f.path));

  // Check for index.html
  const hasIndexHtml = files.some((f) => f.path === "index.html");
  if (!hasIndexHtml) {
    items.push({ level: "failed", code: "MISSING_INDEX_HTML" });
  }

  // Check for service worker
  for (const f of files) {
    const name = f.path.split("/").pop() || "";
    if (name === "service-worker.js" || name === "sw.js") {
      items.push({ level: "warning", code: "SERVICE_WORKER_DETECTED", details: { file: f.path } });
      break;
    }
  }

  // Check for sourcemap files
  for (const f of files) {
    if (f.path.endsWith(".map")) {
      items.push({ level: "warning", code: "SOURCE_MAP_DETECTED", details: { file: f.path } });
    }
  }

  // Check for .env files
  for (const f of files) {
    const name = f.path.split("/").pop() || "";
    if (ENV_FILE_PATTERNS.some((p) => p.test(name))) {
      items.push({ level: "failed", code: "ENV_FILE_DETECTED", details: { file: f.path } });
    }
  }

  // Check for secret files
  for (const f of files) {
    const name = f.path.split("/").pop() || "";
    const ext = name.includes(".") ? "." + name.split(".").pop() : "";
    if (SECRET_FILE_EXTENSIONS.includes(ext) || SECRET_FILE_NAMES.includes(name)) {
      items.push({ level: "failed", code: "SECRET_FILE_DETECTED", details: { file: f.path } });
    }
  }

  // Check for .git directory
  for (const f of files) {
    if (f.path.startsWith(".git/") || f.path === ".git") {
      items.push({ level: "failed", code: "GIT_DIR_DETECTED", details: { file: f.path } });
    }
  }

  // Check for system files
  for (const f of files) {
    const name = f.path.split("/").pop() || "";
    if (name === ".DS_Store" || name === "Thumbs.db" || f.path === "__MACOSX/" || f.path.startsWith("__MACOSX/")) {
      items.push({ level: "info", code: "SYSTEM_FILE_DETECTED", details: { file: f.path } });
    }
  }

  return items;
}

function detectRootAssetReferences(html: string): DetectItem[] {
  const items: DetectItem[] = [];
  const patterns: Array<{ pattern: RegExp; code: string }> = [
    { pattern: /(?:src|href)\s*=\s*["']\/assets\//gi, code: "ROOT_ASSET_PATH_DETECTED" },
    { pattern: /(?:src|href|poster|data-src)\s*=\s*["']\/(?!\/)(?!assets\/)(?!_api)(?!_console)(?!_health)/gi, code: "ROOT_PATH_REFERENCE_DETECTED" },
  ];

  const reservedDetected = new Set<string>();
  for (const reservedPath of RESERVED_PLATFORM_PATHS) {
    const escaped = reservedPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`["']${escaped}`, "gi");
    if (re.test(html)) {
      reservedDetected.add(reservedPath);
    }
  }
  if (reservedDetected.size > 0) {
    items.push({
      level: "warning",
      code: "RESERVED_PLATFORM_PATH_REFERENCED",
      details: { paths: [...reservedDetected] },
    });
  }

  for (const { pattern, code } of patterns) {
    if (pattern.test(html)) {
      items.push({ level: "warning", code });
    }
  }

  return items;
}

function detectCssRootReferences(css: string): DetectItem[] {
  const items: DetectItem[] = [];
  // Match url('/assets/...') or url("/assets/...") or url(/assets/...)
  const urlPattern = /url\(['"]?\/(?:assets\/)/gi;
  if (urlPattern.test(css)) {
    items.push({ level: "warning", code: "ROOT_ASSET_PATH_DETECTED" });
  }
  return items;
}

function checkReferencedAssets(files: FileEntry[]): DetectItem[] {
  const items: DetectItem[] = [];
  const hasAssetsDir = files.some((f) => f.path.startsWith("assets/"));
  const hasIndexHtml = files.find((f) => f.path === "index.html");

  if (!hasAssetsDir && hasIndexHtml) {
    try {
      const content = readFileSync(hasIndexHtml.absPath, "utf-8");
      if (/\.\/assets\//.test(content) || /\.\/assets\//.test(content)) {
        items.push({ level: "warning", code: "REFERENCED_ASSETS_DIR_MISSING" });
      }
    } catch {
      // Skip if can't read
    }
  }

  return items;
}

export async function runDetection(
  files: FileEntry[],
  options?: {
    detectMode?: DetectMode;
    maxIndexHtmlAnalyzeSize?: number;
    maxCssAnalyzeSize?: number;
  },
): Promise<DetectResult> {
  const maxHtmlSize = options?.maxIndexHtmlAnalyzeSize ?? 512 * 1024;
  const allItems: DetectItem[] = [];

  // 1. File name/pattern scanning
  allItems.push(...scanForRisks(files));

  // 2. Index.html content analysis
  const indexHtml = files.find((f) => f.path === "index.html");
  if (indexHtml) {
    try {
      const fd = openSync(indexHtml.absPath, "r");
      const buffer = Buffer.alloc(Math.min(maxHtmlSize, indexHtml.size));
      readSync(fd, buffer, 0, buffer.length, 0);
      closeSync(fd);
      const html = buffer.toString("utf-8");
      allItems.push(...detectRootAssetReferences(html));
    } catch {
      // If we can't read index.html, it was already reported by scanForRisks
    }
  }

  // 3. CSS content analysis (only scan up to maxCssAnalyzeSize)
  const cssAnalyzeSize = options?.maxCssAnalyzeSize ?? 1 * 1024 * 1024;
  for (const f of files) {
    if (f.path.endsWith(".css") && f.size > 0) {
      if (f.size > cssAnalyzeSize) continue; // Skip oversized CSS files
      try {
        const css = readFileSync(f.absPath, "utf-8");
        allItems.push(...detectCssRootReferences(css));
      } catch {
        // Skip unreadable CSS
      }
    }
  }

  // 4. Referenced assets check
  allItems.push(...checkReferencedAssets(files));

  // Compute overall level
  const level: "pass" | "warning" | "failed" = allItems.some((i) => i.level === "failed")
    ? "failed"
    : allItems.some((i) => i.level === "warning")
      ? "warning"
      : "pass";

  // Only return non-pass items
  const nonPassItems = allItems.filter((i) => i.level !== "pass");

  return { level, items: nonPassItems };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
bun test packages/deploy-core/tests/unit/detect.test.ts
```

Expected: All 13 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/deploy-core/src/detect.ts packages/deploy-core/tests/unit/detect.test.ts
git commit -m "feat(deploy-core): add artifact security and content detection

- Implement runDetection with scanForRisks + index.html + CSS analysis
- Detect: missing index.html, service worker, sourcemap, .env, secret files, .git
- Detect: root asset paths (/assets), platform reserved paths, system files
- Index.html content analysis (regex-based, first 512KB)
- CSS url() root reference detection
- 13 unit tests covering all detection categories

Co-Authored-By: Claude <noreply@anthropic.com>"
codegraph sync

---

### Task 7: Manifest + Hash (manifest.ts + hash.ts)

**Files:**
- Create: `packages/deploy-core/src/hash.ts`
- Create: `packages/deploy-core/src/manifest.ts`
- Create: `packages/deploy-core/tests/unit/manifest.test.ts`

**Interfaces:**
- Consumes: `FileEntry`, `ManifestEntry`, `Manifest` (types.ts)
- Produces: `hashFile(absPath): Promise<string>`, `deriveReleaseHash(fullHash, length?): string`, `buildManifest(files): Promise<Manifest>`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/deploy-core/tests/unit/manifest.test.ts

import { describe, expect, test } from "bun:test";
import { writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { hashFile, deriveReleaseHash } from "../../src/hash";
import { buildManifest } from "../../src/manifest";
import type { FileEntry } from "../../src/types";

const TMP = join(import.meta.dir, "../.tmp-manifest-test");

function makeEntry(relPath: string, absPath: string): FileEntry {
  return { path: relPath, absPath, size: 0 };
}

function createFile(relPath: string, content: string): { entry: FileEntry; absPath: string } {
  mkdirSync(join(TMP, relPath, ".."), { recursive: true });
  const absPath = join(TMP, relPath);
  writeFileSync(absPath, content, "utf-8");
  return { entry: makeEntry(relPath, absPath), absPath };
}

beforeAll(() => {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
});

afterAll(() => {
  rmSync(TMP, { recursive: true, force: true });
});

describe("hashFile", () => {
  test("returns SHA-256 hex string", async () => {
    const { absPath } = createFile("hash-test.txt", "hello world");
    const hash = await hashFile(absPath);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  test("same content produces same hash", async () => {
    const { absPath: f1 } = createFile("same-a.txt", "same content");
    const { absPath: f2 } = createFile("same-b.txt", "same content");
    const h1 = await hashFile(f1);
    const h2 = await hashFile(f2);
    expect(h1).toBe(h2);
  });

  test("different content produces different hash", async () => {
    const { absPath: f1 } = createFile("diff-a.txt", "content a");
    const { absPath: f2 } = createFile("diff-b.txt", "content b");
    const h1 = await hashFile(f1);
    const h2 = await hashFile(f2);
    expect(h1).not.toBe(h2);
  });
});

describe("deriveReleaseHash", () => {
  const fullHash = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2";

  test("default length is 12", () => {
    expect(deriveReleaseHash(fullHash)).toBe("a1b2c3d4e5f6");
  });

  test("custom length works", () => {
    expect(deriveReleaseHash(fullHash, 16)).toBe("a1b2c3d4e5f6a7b8");
  });

  test("length exceeding hash returns full hash", () => {
    expect(deriveReleaseHash("abc", 100)).toBe("abc");
  });
});

describe("buildManifest", () => {
  test("generates manifest with sorted files", async () => {
    const f1 = createFile("z_last.txt", "zzz");
    const f2 = createFile("a_first.txt", "aaa");
    const f3 = createFile("m_middle.txt", "mmm");
    const files = [f1.entry, f2.entry, f3.entry];

    const manifest = await buildManifest(files);
    expect(manifest.files.length).toBe(3);
    // Must be sorted alphabetically by path
    expect(manifest.files[0].path).toBe("a_first.txt");
    expect(manifest.files[1].path).toBe("m_middle.txt");
    expect(manifest.files[2].path).toBe("z_last.txt");
  });

  test("same content produces same manifest hash", async () => {
    const f1 = createFile("manifest-a/index.html", "<h1>a</h1>");
    const f2 = createFile("manifest-a/style.css", "body {}");
    const files1 = [f1.entry, f2.entry];

    // Create same files in different order
    const files2 = [f2.entry, f1.entry];

    const m1 = await buildManifest(files1);
    const m2 = await buildManifest(files2);
    expect(m1.hash).toBe(m2.hash);
    expect(m1.releaseHash).toBe(m2.releaseHash);
  });

  test("different content produces different hash", async () => {
    const fa = createFile("diff/index.html", "<h1>version A</h1>");
    const fb = createFile("diff/index.html", "<h1>version B</h1>");
    // Re-create with different content
    const a1 = createFile("diff-v-a/index.html", "<h1>version A</h1>");
    const b1 = createFile("diff-v-b/index.html", "<h1>version B</h1>");

    const m1 = await buildManifest([a1.entry]);
    const m2 = await buildManifest([b1.entry]);
    expect(m1.hash).not.toBe(m2.hash);
  });

  test("releaseHash is first 12 characters of hash", async () => {
    const f = createFile("release-hash/index.html", "<h1>test</h1>");
    const manifest = await buildManifest([f.entry]);
    expect(manifest.releaseHash.length).toBe(12);
    expect(manifest.hash.startsWith(manifest.releaseHash)).toBe(true);
  });

  test("empty file list produces empty manifest", async () => {
    const manifest = await buildManifest([]);
    expect(manifest.files).toEqual([]);
    expect(manifest.hash).toBeTypeOf("string");
    expect(manifest.hash.length).toBe(64);
    expect(manifest.releaseHash.length).toBe(12);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test packages/deploy-core/tests/unit/manifest.test.ts
```

Expected: FAIL — `hashFile`, `deriveReleaseHash`, `buildManifest` not found.

- [ ] **Step 3: Write hash.ts**

```typescript
// packages/deploy-core/src/hash.ts

import { createHash } from "crypto";
import { createReadStream } from "fs";

/**
 * Compute SHA-256 hex hash of a file using streaming reads.
 */
export async function hashFile(absPath: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(absPath);

    stream.on("data", (chunk: Buffer) => {
      hash.update(chunk);
    });

    stream.on("end", () => {
      resolve(hash.digest("hex"));
    });

    stream.on("error", (err) => {
      reject(err);
    });
  });
}

/**
 * Derive a truncated release hash from the full manifest hash.
 */
export function deriveReleaseHash(fullHash: string, length = 12): string {
  return fullHash.slice(0, Math.min(length, fullHash.length));
}
```

- [ ] **Step 4: Write manifest.ts**

```typescript
// packages/deploy-core/src/manifest.ts

import type { FileEntry, Manifest, ManifestEntry } from "./types";
import { hashFile } from "./hash";

/**
 * Build a content-addressed manifest from extracted files.
 *
 * Steps:
 * 1. Hash each file's content (SHA-256, streamed)
 * 2. Sort entries by path (ASCII order, deterministic)
 * 3. Serialize to JSON, hash the JSON
 * 4. Derive releaseHash (first 12 characters)
 */
export async function buildManifest(files: FileEntry[]): Promise<Manifest> {
  // Hash all files in parallel
  const manifestEntries: ManifestEntry[] = await Promise.all(
    files.map(async (file) => ({
      path: file.path,
      hash: await hashFile(file.absPath),
      size: file.size,
    })),
  );

  // Stable sort by path
  manifestEntries.sort((a, b) => a.path.localeCompare(b.path));

  // JSON serialization — use stable key order
  const json = JSON.stringify({ version: 1, hashAlgorithm: "sha256", files: manifestEntries });
  const hash = await hashJsonString(json);
  const releaseHash = hash.slice(0, 12);

  return { files: manifestEntries, hash, releaseHash };
}

async function hashJsonString(json: string): Promise<string> {
  const { createHash } = await import("crypto");
  return createHash("sha256").update(json, "utf-8").digest("hex");
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
bun test packages/deploy-core/tests/unit/manifest.test.ts
```

Expected: All 9 tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/deploy-core/src/hash.ts packages/deploy-core/src/manifest.ts packages/deploy-core/tests/unit/manifest.test.ts
git commit -m "feat(deploy-core): add file hashing and manifest generation

- Implement hashFile: streaming SHA-256 via Node crypto
- Implement deriveReleaseHash: truncate full hash to configurable length
- Implement buildManifest: hash all files, sort by path, compute manifest hash
- Deterministic output: same content = same hash regardless of entry order
- 9 unit tests covering hash consistency, sorting, and releaseHash derivation

Co-Authored-By: Claude <noreply@anthropic.com>"
codegraph sync

---

### Task 8: Pipeline (index.ts) + Final Integration

**Files:**
- Modify: `packages/deploy-core/src/index.ts`
- Create: `packages/deploy-core/tests/unit/pipeline.test.ts`

**Interfaces:**
- Consumes: all previous modules
- Produces: `processRelease(options): Promise<ReleaseResult>` + re-exports

- [ ] **Step 1: Write the integration test**

```typescript
// packages/deploy-core/tests/unit/pipeline.test.ts

import { describe, expect, test, beforeAll } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { processRelease } from "../../src/index";
import { DeployCoreError } from "../../src/errors";

const FIXTURES_DIR = join(import.meta.dir, "../fixtures");
const TMP_DIR = join(import.meta.dir, "../.tmp-pipeline-test");

beforeAll(() => {
  rmSync(TMP_DIR, { recursive: true, force: true });
  mkdirSync(TMP_DIR, { recursive: true });
});

async function runDir(name: string): Promise<string> {
  const dir = join(TMP_DIR, name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("processRelease (integration)", () => {
  test("valid Vite relative base → pass", async () => {
    const workDir = await runDir("valid");
    const result = await processRelease({
      zipPath: join(FIXTURES_DIR, "valid-vite-relative-base.zip"),
      workDir,
    });
    expect(result.detect.level).toBe("pass");
    expect(result.files.length).toBeGreaterThan(0);
    expect(result.manifest.files.length).toBe(result.files.length);
    expect(result.manifest.releaseHash.length).toBe(12);
    expect(existsSync(result.manifest.files[0].path));
  });

  test("nested dist folder gets re-rooted", async () => {
    const workDir = await runDir("nested");
    const result = await processRelease({
      zipPath: join(FIXTURES_DIR, "nested-dist-folder.zip"),
      workDir,
    });
    // After re-rooting, files should be at root
    expect(result.files.some((f) => f.path === "index.html")).toBe(true);
    expect(result.files.some((f) => f.path === "assets/index.js")).toBe(true);
  });

  test("missing index.html → detect failed", async () => {
    const workDir = await runDir("missing-index");
    const result = await processRelease({
      zipPath: join(FIXTURES_DIR, "missing-index.zip"),
      workDir,
    });
    expect(result.detect.level).toBe("failed");
    expect(result.detect.items.some((i) => i.code === "MISSING_INDEX_HTML")).toBe(true);
  });

  test("zip-slip → throws error", async () => {
    const workDir = await runDir("slip");
    try {
      await processRelease({
        zipPath: join(FIXTURES_DIR, "zip-slip.zip"),
        workDir,
      });
      expect.unreachable("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(DeployCoreError);
    }
  });

  test("detect-level issues don't throw", async () => {
    const workDir = await runDir("warn");
    const result = await processRelease({
      zipPath: join(FIXTURES_DIR, "valid-vite-root-base-warning.zip"),
      workDir,
    });
    // Should not throw even though detect has warnings
    expect(result.detect.level).toBe("warning");
    expect(result.manifest.releaseHash.length).toBe(12);
  });

  test("same zip produces same release hash", async () => {
    const d1 = await runDir("same-1");
    const d2 = await runDir("same-2");
    const r1 = await processRelease({
      zipPath: join(FIXTURES_DIR, "valid-vite-relative-base.zip"),
      workDir: d1,
    });
    const r2 = await processRelease({
      zipPath: join(FIXTURES_DIR, "valid-vite-relative-base.zip"),
      workDir: d2,
    });
    expect(r1.manifest.releaseHash).toBe(r2.manifest.releaseHash);
    expect(r1.manifest.hash).toBe(r2.manifest.hash);
  });
});

describe("exports", () => {
  test("isValidProjectSlug is still exported", async () => {
    const { isValidProjectSlug } = await import("../../src/index");
    expect(isValidProjectSlug("valid-slug")).toBe(true);
    expect(isValidProjectSlug("_invalid")).toBe(false);
  });
});
```

- [ ] **Step 2: Write the updated index.ts**

```typescript
// packages/deploy-core/src/index.ts

import { ZIPSHIP_RESERVED_SLUGS } from "@zipship/shared";
import { safeExtractZip } from "./unzip";
import { resolveArtifactRoot } from "./root";
import { runDetection } from "./detect";
import { buildManifest } from "./manifest";
import type { ProcessReleaseOptions, ReleaseResult } from "./types";
import { resolveReleaseLimits } from "./limits";

export { safeExtractZip } from "./unzip";
export { resolveArtifactRoot } from "./root";
export { runDetection } from "./detect";
export { buildManifest } from "./manifest";
export { hashFile, deriveReleaseHash } from "./hash";
export { DeployCoreError, DEPLOY_CORE_ERROR_CODES } from "./errors";
export { DEFAULT_RELEASE_LIMITS, resolveReleaseLimits } from "./limits";
export type * from "./types";

const slugPattern = /^[a-z0-9][a-z0-9_-]*$/;

export function isValidProjectSlug(slug: string): boolean {
  return slugPattern.test(slug) && !ZIPSHIP_RESERVED_SLUGS.includes(slug as never);
}

export async function processRelease(options: ProcessReleaseOptions): Promise<ReleaseResult> {
  const limits = resolveReleaseLimits(options.limits);

  const extractedFiles = await safeExtractZip(options.zipPath, options.workDir, limits);

  const { rootDir, files } = resolveArtifactRoot(extractedFiles, options.workDir);

  const detect = await runDetection(files, {
    detectMode: options.detectMode ?? "auto",
    maxIndexHtmlAnalyzeSize: limits.maxIndexHtmlAnalyzeSize,
    maxCssAnalyzeSize: limits.maxCssAnalyzeSize,
  });

  const manifest = await buildManifest(files);

  return {
    rootDir,
    files,
    detect,
    manifest,
  };
}
```

The existing `tests/unit/project-slug.test.ts` imports from `@zipship/deploy-core`, which resolves to this index.ts. Since `isValidProjectSlug` is a direct export here, the existing import will work without changes.

- [ ] **Step 3: Run deploy-core test suite**

```bash
bun test packages/deploy-core/tests
```

Expected: All tests pass (path, unzip, root, detect, manifest, pipeline).

- [ ] **Step 4: Run typecheck**

```bash
bun run --filter @zipship/deploy-core typecheck
```

Expected: No type errors.

- [ ] **Step 5: Run ALL project tests**

```bash
bun test
```

Expected: All tests pass (existing 42 tests + new deploy-core tests).

- [ ] **Step 6: Commit**

```bash
git add packages/deploy-core/src/index.ts packages/deploy-core/tests/unit/pipeline.test.ts
git commit -m "feat(deploy-core): add processRelease pipeline and integration tests

- Implement processRelease orchestrating extract → root-detection → detect → manifest
- Re-export all module functions and types from index.ts
- Preserve existing isValidProjectSlug export
- 6 integration tests covering valid flow, nested dir, failure, hash stability
- All existing 42 tests remain passing

Co-Authored-By: Claude <noreply@anthropic.com>"
codegraph sync

---

### Task 9: Final Verification and Cleanup

**Files:**
- None — verification pass

- [ ] **Step 1: Full typecheck**

```bash
bun run typecheck
```

- [ ] **Step 2: Full test suite**

```bash
bun test
```

- [ ] **Step 3: Push to remote**

```bash
git push origin deepseek-job
```
