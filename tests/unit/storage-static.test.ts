import { describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync, writeFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { contentTypeForPath, resolveStaticAssetPath } from "../../packages/storage/src/index";

function createTempRoot() {
  return mkdtempSync(join(tmpdir(), "zipship-storage-static-"));
}

describe("resolveStaticAssetPath", () => {
  test("resolves files inside the static root", async () => {
    const root = createTempRoot();
    try {
      mkdirSync(join(root, "assets"), { recursive: true });
      writeFileSync(join(root, "index.html"), "<script src=\"./assets/index.js\"></script>");
      writeFileSync(join(root, "assets/index.js"), "console.log('zipship')");

      const resolvedRoot = realpathSync(root);
      const resolved = await resolveStaticAssetPath({
        rootDir: root,
        requestPath: "assets/index.js",
      });

      expect(resolved).toEqual({
        kind: "file",
        absolutePath: join(resolvedRoot, "assets/index.js"),
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("falls back to index.html for unknown SPA paths", async () => {
    const root = createTempRoot();
    try {
      writeFileSync(join(root, "index.html"), "<main>app</main>");

      const resolvedRoot = realpathSync(root);
      const resolved = await resolveStaticAssetPath({
        rootDir: root,
        requestPath: "dashboard/settings",
      });

      expect(resolved).toEqual({
        kind: "file",
        absolutePath: join(resolvedRoot, "index.html"),
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("rejects traversal and absolute paths", async () => {
    const root = createTempRoot();
    try {
      writeFileSync(join(root, "index.html"), "<main>app</main>");

      await expect(resolveStaticAssetPath({ rootDir: root, requestPath: "../secret.txt" })).resolves.toEqual({ kind: "not-found" });
      await expect(resolveStaticAssetPath({ rootDir: root, requestPath: "%2e%2e/secret.txt" })).resolves.toEqual({ kind: "not-found" });
      await expect(resolveStaticAssetPath({ rootDir: root, requestPath: "%25252525252e%25252525252e%25252525252fsecret.txt" })).resolves.toEqual({
        kind: "not-found",
      });
      await expect(resolveStaticAssetPath({ rootDir: root, requestPath: "..%5Csecret.txt" })).resolves.toEqual({ kind: "not-found" });
      await expect(resolveStaticAssetPath({ rootDir: root, requestPath: "/etc/passwd" })).resolves.toEqual({ kind: "not-found" });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("contentTypeForPath", () => {
  test("maps common static file extensions", () => {
    expect(contentTypeForPath("index.html")).toBe("text/html; charset=utf-8");
    expect(contentTypeForPath("index.js")).toBe("text/javascript; charset=utf-8");
    expect(contentTypeForPath("style.css")).toBe("text/css; charset=utf-8");
    expect(contentTypeForPath("data.json")).toBe("application/json; charset=utf-8");
    expect(contentTypeForPath("image.png")).toBe("image/png");
    expect(contentTypeForPath("unknown.bin")).toBe("application/octet-stream");
  });
});
