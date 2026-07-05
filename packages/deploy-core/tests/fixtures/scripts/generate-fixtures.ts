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
