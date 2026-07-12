import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { mkdir } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { buildNginxProjectAccessSnippet } from "@zipship/shared";

const nginxAvailable = process.platform !== "win32" && await commandSucceeds(["nginx", "-v"]);

describe.skipIf(!nginxAvailable)("nginx access plane routing", () => {
  const root = mkdtempSync(join(tmpdir(), "zipship-nginx-"));
  const sitesRoot = join(root, "sites");
  const consoleRoot = join(root, "console");
  const confPath = join(root, "zipship.conf");
  const projectsConfPath = join(root, "zipship-projects.conf");
  const pidPath = join(root, "nginx.pid");
  const port = 18080 + Math.floor(Math.random() * 1000);

  beforeAll(async () => {
    await mkdir(join(sitesRoot, "admin", "releases", "a8f32c91abcd", "assets"), { recursive: true });
    await mkdir(join(sitesRoot, "admin", "current", "assets"), { recursive: true });
    await mkdir(join(sitesRoot, "landing", "releases", "a8f32c91abcd", "assets"), { recursive: true });
    await mkdir(join(sitesRoot, "landing", "current", "assets"), { recursive: true });
    await mkdir(consoleRoot, { recursive: true });

    writeFileSync(join(sitesRoot, "admin", "releases", "a8f32c91abcd", "index.html"), "release index");
    writeFileSync(join(sitesRoot, "admin", "releases", "a8f32c91abcd", "assets", "index.js"), "release asset");
    writeFileSync(join(sitesRoot, "admin", "current", "index.html"), "current index");
    writeFileSync(join(sitesRoot, "admin", "current", "assets", "index.js"), "current asset");
    writeFileSync(join(sitesRoot, "landing", "releases", "a8f32c91abcd", "index.html"), "landing release index");
    writeFileSync(join(sitesRoot, "landing", "releases", "a8f32c91abcd", "assets", "index.js"), "landing release asset");
    writeFileSync(join(sitesRoot, "landing", "current", "index.html"), "landing current index");
    writeFileSync(join(sitesRoot, "landing", "current", "assets", "index.js"), "landing current asset");
    writeFileSync(join(consoleRoot, "index.html"), "console app");
    writeFileSync(
      projectsConfPath,
      buildNginxProjectAccessSnippet(
        {
          slug: "landing",
          spaFallback: false,
          cachePolicy: "standard",
          customDomains: [],
        },
        { sitesRoot },
      ).config,
    );

    const template = await Bun.file(join(import.meta.dir, "../../infra/nginx/zipship.conf")).text();
    writeFileSync(
      confPath,
      template
        .replaceAll("${ZIPSHIP_LISTEN_PORT}", String(port))
        .replaceAll("${ZIPSHIP_MAX_BODY_SIZE}", "500m")
        .replaceAll("${ZIPSHIP_SITES_ROOT}", sitesRoot)
        .replaceAll("${ZIPSHIP_CONSOLE_ROOT}", consoleRoot)
        .replaceAll("${ZIPSHIP_API_UPSTREAM}", "http://127.0.0.1:9")
        .replaceAll("${ZIPSHIP_NGINX_PID}", pidPath)
        .replaceAll("${ZIPSHIP_PROJECTS_CONF}", projectsConfPath),
    );

    const proc = Bun.spawn(["nginx", "-c", confPath, "-p", root], { stderr: "pipe" });
    const code = await proc.exited;
    if (code !== 0) {
      throw new Error(await new Response(proc.stderr).text());
    }
  });

  afterAll(async () => {
    if (existsSync(pidPath)) {
      await Bun.spawn(["nginx", "-s", "stop", "-c", confPath, "-p", root]).exited;
    }
    rmSync(root, { recursive: true, force: true });
  });

  test("redirects slug and release hash roots to trailing slash", async () => {
    const current = await fetch(`http://127.0.0.1:${port}/admin`, { redirect: "manual" });
    expect(current.status).toBe(308);
    expect(current.headers.get("location")).toBe("/admin/");

    const release = await fetch(`http://127.0.0.1:${port}/admin/a8f32c91abcd`, { redirect: "manual" });
    expect(release.status).toBe(308);
    expect(release.headers.get("location")).toBe("/admin/a8f32c91abcd/");
  });

  test("serves current and release files with SPA fallback", async () => {
    await expectText(`http://127.0.0.1:${port}/admin/`, "current index");
    await expectText(`http://127.0.0.1:${port}/admin/assets/index.js`, "current asset", "immutable");
    await expectText(`http://127.0.0.1:${port}/admin/settings`, "current index", "no-cache");
    await expectText(`http://127.0.0.1:${port}/admin/a8f32c91abcd/`, "release index");
    await expectText(`http://127.0.0.1:${port}/admin/a8f32c91abcd/assets/index.js`, "release asset", "immutable");
    await expectText(`http://127.0.0.1:${port}/admin/a8f32c91abcd/settings`, "release index", "no-cache");
    await expectText(`http://127.0.0.1:${port}/admin/not-a-hash/settings`, "current index", "no-cache");
  });

  test("treats non-12-character hex segments as current-version SPA paths", async () => {
    const redirect = await fetch(`http://127.0.0.1:${port}/admin/a8f32c91`, { redirect: "manual" });
    expect(redirect.status).toBe(200);
    expect(await redirect.text()).toContain("current index");

    await expectText(`http://127.0.0.1:${port}/admin/a8f32c91/`, "current index", "no-cache");
    await expectText(`http://127.0.0.1:${port}/admin/a8f32c91/settings`, "current index", "no-cache");
  });

  test("applies generated project policy before generic slug routes", async () => {
    await expectText(`http://127.0.0.1:${port}/landing/assets/index.js`, "landing current asset", "max-age=3600");
    expect((await fetch(`http://127.0.0.1:${port}/landing/settings`)).status).toBe(404);
    expect((await fetch(`http://127.0.0.1:${port}/landing/a8f32c91abcd/settings`)).status).toBe(404);
  });

  test("serves console and keeps unknown sites or hashes as 404", async () => {
    await expectText(`http://127.0.0.1:${port}/_console/`, "console app");

    expect((await fetch(`http://127.0.0.1:${port}/missing/`)).status).toBe(404);
    expect((await fetch(`http://127.0.0.1:${port}/admin/deadbeef0000/`)).status).toBe(404);
  });
});

async function expectText(url: string, expected: string, expectedCache?: string) {
  const response = await fetch(url);
  expect(response.status).toBe(200);
  expect(await response.text()).toContain(expected);
  if (expectedCache) {
    expect(response.headers.get("cache-control")).toContain(expectedCache);
  }
}

async function commandSucceeds(command: string[]): Promise<boolean> {
  try {
    return (await Bun.spawn(command, { stdout: "ignore", stderr: "ignore" }).exited) === 0;
  } catch {
    console.warn("Skipping nginx routing tests because nginx is not installed.");
    return false;
  }
}
