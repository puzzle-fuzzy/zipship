// packages/deploy-core/tests/unit/pipeline.test.ts

import { describe, expect, test, beforeAll } from "bun:test";
import { mkdirSync, rmSync } from "fs";
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
