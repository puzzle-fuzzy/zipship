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
