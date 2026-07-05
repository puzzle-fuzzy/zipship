// packages/deploy-core/tests/unit/manifest.test.ts

import { beforeAll, afterAll, describe, expect, test } from "bun:test";
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
