import { describe, expect, test } from "bun:test";
import { existsSync, lstatSync, mkdtempSync, realpathSync, rmSync, writeFileSync, mkdirSync } from "fs";
import { mkdir } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import {
  contentTypeForPath,
  createCurrentReleaseLinkPath,
  createProjectSitePath,
  createReleaseStoragePath,
  createStoragePaths,
  ensureReleaseArtifactReady,
  resolveStaticAssetPath,
  switchCurrentReleaseLink,
  ReleaseArtifactNotFoundError,
} from "../../packages/storage/src/index";
import { readLinkTarget } from "../helpers/path";

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

function createTempStorageRoot() {
  return mkdtempSync(join(tmpdir(), "zipship-storage-access-"));
}

describe("slug-based site storage paths", () => {
  test("creates project site, release, and current paths from project slug", () => {
    const paths = createStoragePaths("/srv/zipship");

    expect(createProjectSitePath(paths, "admin")).toBe(join("/srv/zipship", "sites/admin"));
    expect(createReleaseStoragePath(paths, { projectSlug: "admin", releaseHash: "a8f32c91abcd" })).toBe(
      join("/srv/zipship", "sites/admin/releases/a8f32c91abcd"),
    );
    expect(createCurrentReleaseLinkPath(paths, "admin")).toBe(join("/srv/zipship", "sites/admin/current"));
  });

  test("verifies a release artifact directory with index.html", async () => {
    const root = createTempStorageRoot();
    try {
      const artifact = join(root, "sites", "admin", "releases", "a8f32c91abcd");
      await mkdir(artifact, { recursive: true });
      writeFileSync(join(artifact, "index.html"), "<html></html>");

      await expect(ensureReleaseArtifactReady(artifact)).resolves.toBeUndefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("rejects missing artifact directory or missing index.html", async () => {
    const root = createTempStorageRoot();
    try {
      const artifact = join(root, "sites", "admin", "releases", "a8f32c91abcd");
      await expect(ensureReleaseArtifactReady(artifact)).rejects.toBeInstanceOf(ReleaseArtifactNotFoundError);

      await mkdir(artifact, { recursive: true });
      await expect(ensureReleaseArtifactReady(artifact)).rejects.toBeInstanceOf(ReleaseArtifactNotFoundError);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("switches current to a relative release symlink and replaces old links", async () => {
    const root = createTempStorageRoot();
    try {
      const paths = createStoragePaths(root);
      const projectSitePath = createProjectSitePath(paths, "admin");
      await mkdir(join(projectSitePath, "releases", "a8f32c91abcd"), { recursive: true });
      await mkdir(join(projectSitePath, "releases", "b7d91f20cafe"), { recursive: true });

      await switchCurrentReleaseLink({ projectSitePath, releaseHash: "a8f32c91abcd" });
      expect(lstatSync(createCurrentReleaseLinkPath(paths, "admin")).isSymbolicLink()).toBe(true);
      expect(readLinkTarget(createCurrentReleaseLinkPath(paths, "admin"))).toBe("releases/a8f32c91abcd");

      await switchCurrentReleaseLink({ projectSitePath, releaseHash: "b7d91f20cafe" });
      expect(readLinkTarget(createCurrentReleaseLinkPath(paths, "admin"))).toBe("releases/b7d91f20cafe");
      expect(existsSync(join(projectSitePath, "current.tmp"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
