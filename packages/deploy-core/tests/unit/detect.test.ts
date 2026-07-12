// packages/deploy-core/tests/unit/detect.test.ts

import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { runDetection } from "../../src/detect";
import type { FileEntry } from "../../src/types";

const TMP_DIR = join(tmpdir(), `zipship-detect-test-${Date.now()}`);

beforeAll(() => {
  rmSync(TMP_DIR, { recursive: true, force: true });
  mkdirSync(TMP_DIR, { recursive: true });
});

afterAll(() => {
  rmSync(TMP_DIR, { recursive: true, force: true });
});

function makeFile(relPath: string, content?: string): FileEntry {
  const absPath = join(TMP_DIR, relPath);
  const body = content ?? "";
  // Ensure parent directory exists
  const parent = dirname(absPath);
  mkdirSync(parent, { recursive: true });
  writeFileSync(absPath, body);
  return {
    path: relPath,
    absPath,
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
    expect(result.insights?.seo.checks.some((i) => i.code === "SEO_TITLE_MISSING")).toBe(true);
    expect(result.level).toBe("pass");
  });

  test("extracts artifact insights from index.html", async () => {
    const files = [
      makeFile(
        "index.html",
        [
          "<!doctype html>",
          '<html lang="en">',
          "<head>",
          '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
          "<title>ZipShip Demo</title>",
          '<meta name="description" content="A small deployable demo site for ZipShip.">',
          '<link rel="canonical" href="https://example.com/">',
          '<meta property="og:title" content="ZipShip Demo">',
          '<meta property="og:description" content="A small deployable demo site for ZipShip.">',
          '<link rel="icon" href="./favicon.ico">',
          "</head>",
          '<body><div id="root"></div><script type="module" src="./assets/index.js"></script></body>',
          "</html>",
        ].join(""),
      ),
      makeFile("assets/index.js", "console.log('ok');"),
      makeFile("assets/style.css", "body { color: #111; }"),
      makeFile("favicon.ico", "ico"),
    ];

    const result = await runDetection(files);

    expect(result.level).toBe("pass");
    expect(result.insights?.entrypoint).toBe("index.html");
    expect(result.insights?.html.title).toBe("ZipShip Demo");
    expect(result.insights?.html.description).toBe("A small deployable demo site for ZipShip.");
    expect(result.insights?.html.hasViewport).toBe(true);
    expect(result.insights?.html.hasCanonical).toBe(true);
    expect(result.insights?.html.hasOpenGraph).toBe(true);
    expect(result.insights?.html.hasFavicon).toBe(true);
    expect(result.insights?.html.lang).toBe("en");
    expect(result.insights?.assets.byType.javascript.count).toBe(1);
    expect(result.insights?.assets.byType.css.count).toBe(1);
    expect(result.insights?.seo.score).toBe(100);
    expect(result.insights?.seo.checks.every((check) => check.status === "pass")).toBe(true);
  });

  test("reports SEO warnings without downgrading deployability", async () => {
    const files = [
      makeFile("index.html", "<html><head><title></title></head><body>Hello</body></html>"),
    ];

    const result = await runDetection(files);

    expect(result.level).toBe("pass");
    expect(result.insights?.seo.score).toBeLessThan(100);
    expect(result.insights?.seo.checks.some((check) => check.code === "SEO_TITLE_MISSING")).toBe(true);
    expect(result.insights?.seo.checks.some((check) => check.code === "SEO_DESCRIPTION_MISSING")).toBe(true);
    expect(result.insights?.seo.checks.some((check) => check.code === "SEO_VIEWPORT_MISSING")).toBe(true);
  });
});
