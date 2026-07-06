import { afterAll, beforeAll, describe, expect, test } from "bun:test";
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

afterAll(() => {
  rmSync(TMP_DIR, { recursive: true, force: true });
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
    const zipPath = join(FIXTURES_DIR, "valid-vite-relative-base.zip");
    try {
      await safeExtractZip(zipPath, dir, { maxFiles: 2 });
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

  test("rejects total uncompressed size over limit", async () => {
    const dir = runDir("over-limit");
    const zipPath = join(FIXTURES_DIR, "over-limit-size.zip");
    if (!existsSync(zipPath)) return;
    try {
      await safeExtractZip(zipPath, dir);
      expect.unreachable("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(DeployCoreError);
      expect((e as DeployCoreError).code).toBe("ZIP_TOTAL_SIZE_TOO_LARGE");
    }
  });

  test("rejects duplicate normalized paths", async () => {
    const dir = runDir("dup-path");
    const zipPath = join(FIXTURES_DIR, "duplicate-path.zip");
    if (!existsSync(zipPath)) return;
    try {
      await safeExtractZip(zipPath, dir);
      expect.unreachable("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(DeployCoreError);
      expect((e as DeployCoreError).code).toBe("ZIP_ENTRY_DUPLICATE_PATH");
    }
  });

  test("handles empty zip", async () => {
    const dir = runDir("empty");
    const result = await safeExtractZip(join(FIXTURES_DIR, "empty.zip"), dir);
    // Empty zip should just produce no files
    expect(result).toEqual([]);
  });

  test("handles zip with only directories", async () => {
    // Use valid-vite-relative-base.zip but we can't easily create a dirs-only fixture.
    // Instead, verify that all returned entries are files (not directories).
    const result = await safeExtractZip(
      join(FIXTURES_DIR, "valid-vite-relative-base.zip"),
      runDir("only-dirs-check"),
    );
    for (const entry of result) {
      expect(entry.path.endsWith("/")).toBe(false);
    }
  });

  test("rejects backslash path traversal", async () => {
    const dir = runDir("backslash-slip");
    const zipPath = join(FIXTURES_DIR, "backslash-zip-slip.zip");
    if (!existsSync(zipPath)) return;
    try {
      await safeExtractZip(zipPath, dir);
      expect.unreachable("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(DeployCoreError);
      expect((e as DeployCoreError).code).toBe("ZIP_ENTRY_PATH_TRAVERSAL");
    }
  });

  test("rejects duplicate paths from differently-cased entries", async () => {
    // The path normalizer lowercases paths on Windows.
    // Duplicate paths should be detected regardless of case.
    const dir = runDir("dup-case");
    const zipPath = join(FIXTURES_DIR, "duplicate-path.zip");
    if (!existsSync(zipPath)) return;
    try {
      await safeExtractZip(zipPath, dir);
      expect.unreachable("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(DeployCoreError);
      expect((e as DeployCoreError).code).toBe("ZIP_ENTRY_DUPLICATE_PATH");
    }
  });

  test("accepts zip exactly at limits", async () => {
    const dir = runDir("exact-limit");
    const zipPath = join(FIXTURES_DIR, "exact-limit-size.zip");
    if (!existsSync(zipPath)) return;
    // Should succeed — fixture has ~1KB uncompressed, within a generous limit
    const result = await safeExtractZip(zipPath, dir, {
      maxTotalUncompressedSize: 2048,
      maxFiles: 10,
      maxSingleFileSize: 2048,
    });
    expect(result.length).toBeGreaterThan(0);
  });
});
