// packages/deploy-core/src/detect.ts

import { openSync, readSync, closeSync, readFileSync } from "fs";
import type { FileEntry, DetectItem, DetectResult, DetectMode } from "./types";
import { buildArtifactInsights } from "./insights";

const SECRET_FILE_EXTENSIONS = [".pem", ".key", ".cert", ".p12", ".pfx", ".pkcs12"];
const SECRET_FILE_NAMES = ["id_rsa", "id_dsa", "id_ecdsa", "id_ed25519"];
const ENV_FILE_PATTERNS = [/^\.env/, /^\.env\.\w+/];
const RESERVED_PLATFORM_PATHS = ["/_api", "/_console", "/_health", "/_assets"];

function scanForRisks(files: FileEntry[]): DetectItem[] {
  const items: DetectItem[] = [];

  // Check for index.html
  const hasIndexHtml = files.some((f) => f.path === "index.html");
  if (!hasIndexHtml) {
    items.push({ level: "failed", code: "MISSING_INDEX_HTML" });
  }

  // Check for service worker
  for (const f of files) {
    const name = f.path.split("/").pop() || "";
    if (name === "service-worker.js" || name === "sw.js") {
      items.push({ level: "warning", code: "SERVICE_WORKER_DETECTED", details: { file: f.path } });
      break;
    }
  }

  // Check for sourcemap files
  for (const f of files) {
    if (f.path.endsWith(".map")) {
      items.push({ level: "warning", code: "SOURCE_MAP_DETECTED", details: { file: f.path } });
    }
  }

  // Check for .env files
  for (const f of files) {
    const name = f.path.split("/").pop() || "";
    if (ENV_FILE_PATTERNS.some((p) => p.test(name))) {
      items.push({ level: "failed", code: "ENV_FILE_DETECTED", details: { file: f.path } });
    }
  }

  // Check for secret files
  for (const f of files) {
    const name = f.path.split("/").pop() || "";
    const ext = name.includes(".") ? "." + name.split(".").pop() : "";
    if (SECRET_FILE_EXTENSIONS.includes(ext) || SECRET_FILE_NAMES.includes(name)) {
      items.push({ level: "failed", code: "SECRET_FILE_DETECTED", details: { file: f.path } });
    }
  }

  // Check for .git directory
  for (const f of files) {
    if (f.path.startsWith(".git/") || f.path === ".git") {
      items.push({ level: "failed", code: "GIT_DIR_DETECTED", details: { file: f.path } });
    }
  }

  // Check for system files
  for (const f of files) {
    const name = f.path.split("/").pop() || "";
    if (name === ".DS_Store" || name === "Thumbs.db" || f.path === "__MACOSX/" || f.path.startsWith("__MACOSX/")) {
      items.push({ level: "info", code: "SYSTEM_FILE_DETECTED", details: { file: f.path } });
    }
  }

  return items;
}

function detectRootAssetReferences(html: string): DetectItem[] {
  const items: DetectItem[] = [];
  const patterns: Array<{ pattern: RegExp; code: string }> = [
    { pattern: /(?:src|href)\s*=\s*["']\/assets\//gi, code: "ROOT_ASSET_PATH_DETECTED" },
    { pattern: /(?:src|href|poster|data-src)\s*=\s*["']\/(?!\/)(?!assets\/)(?!_api)(?!_console)(?!_health)/gi, code: "ROOT_PATH_REFERENCE_DETECTED" },
  ];

  const reservedDetected = new Set<string>();
  for (const reservedPath of RESERVED_PLATFORM_PATHS) {
    const escaped = reservedPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`["']${escaped}`, "gi");
    if (re.test(html)) {
      reservedDetected.add(reservedPath);
    }
  }
  if (reservedDetected.size > 0) {
    items.push({
      level: "warning",
      code: "RESERVED_PLATFORM_PATH_REFERENCED",
      details: { paths: [...reservedDetected] },
    });
  }

  for (const { pattern, code } of patterns) {
    if (pattern.test(html)) {
      items.push({ level: "warning", code });
    }
  }

  return items;
}

function detectCssRootReferences(css: string): DetectItem[] {
  const items: DetectItem[] = [];
  // Match url('/assets/...') or url("/assets/...") or url(/assets/...)
  const urlPattern = /url\(['"]?\/(?:assets\/)/gi;
  if (urlPattern.test(css)) {
    items.push({ level: "warning", code: "ROOT_ASSET_PATH_DETECTED" });
  }
  return items;
}

function checkReferencedAssets(files: FileEntry[]): DetectItem[] {
  const items: DetectItem[] = [];
  const hasAssetsDir = files.some((f) => f.path.startsWith("assets/"));
  const hasIndexHtml = files.find((f) => f.path === "index.html");

  if (!hasAssetsDir && hasIndexHtml) {
    try {
      const content = readFileSync(hasIndexHtml.absPath, "utf-8");
      if (/\.\/assets\//.test(content) || /\.\/assets\//.test(content)) {
        items.push({ level: "warning", code: "REFERENCED_ASSETS_DIR_MISSING" });
      }
    } catch {
      // Skip if can't read
    }
  }

  return items;
}

export async function runDetection(
  files: FileEntry[],
  options?: {
    detectMode?: DetectMode;
    maxIndexHtmlAnalyzeSize?: number;
    maxCssAnalyzeSize?: number;
  },
): Promise<DetectResult> {
  const maxHtmlSize = options?.maxIndexHtmlAnalyzeSize ?? 512 * 1024;
  const allItems: DetectItem[] = [];

  // 1. File name/pattern scanning
  allItems.push(...scanForRisks(files));

  // 2. Index.html content analysis
  const indexHtml = files.find((f) => f.path === "index.html");
  if (indexHtml) {
    try {
      const fd = openSync(indexHtml.absPath, "r");
      const buffer = Buffer.alloc(Math.min(maxHtmlSize, indexHtml.size));
      readSync(fd, buffer, 0, buffer.length, 0);
      closeSync(fd);
      const html = buffer.toString("utf-8");
      allItems.push(...detectRootAssetReferences(html));
    } catch {
      // If we can't read index.html, it was already reported by scanForRisks
    }
  }

  // 3. CSS content analysis (only scan up to maxCssAnalyzeSize)
  const cssAnalyzeSize = options?.maxCssAnalyzeSize ?? 1 * 1024 * 1024;
  for (const f of files) {
    if (f.path.endsWith(".css") && f.size > 0) {
      if (f.size > cssAnalyzeSize) continue; // Skip oversized CSS files
      try {
        const css = readFileSync(f.absPath, "utf-8");
        allItems.push(...detectCssRootReferences(css));
      } catch {
        // Skip unreadable CSS
      }
    }
  }

  // 4. Referenced assets check
  allItems.push(...checkReferencedAssets(files));

  // 5. Artifact insights and static SEO checks. SEO is informational here:
  // a missing description should not downgrade deployability.
  const insights = await buildArtifactInsights(files);

  // Compute overall level
  const level: "pass" | "warning" | "failed" = allItems.some((i) => i.level === "failed")
    ? "failed"
    : allItems.some((i) => i.level === "warning")
      ? "warning"
      : "pass";

  return { level, items: allItems, insights };
}
