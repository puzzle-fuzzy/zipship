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
