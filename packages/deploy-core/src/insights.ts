import { readFileSync } from "fs";
import { extname } from "path";
import type {
  ArtifactAssetSummary,
  ArtifactAssetTypeSummary,
  ArtifactHtmlMetadata,
  ArtifactInsights,
  ArtifactSeoCheck,
  ArtifactSeoSummary,
  FileEntry,
} from "./types";

const EMPTY_TYPE_SUMMARY: ArtifactAssetTypeSummary = { count: 0, totalSize: 0 };

export async function buildArtifactInsights(files: FileEntry[]): Promise<ArtifactInsights> {
  const indexHtml = files.find((file) => file.path === "index.html") ?? null;
  const htmlText = indexHtml ? readTextFile(indexHtml.absPath) : "";
  const html = analyzeHtml(htmlText);

  return {
    entrypoint: indexHtml?.path ?? null,
    assets: summarizeAssets(files),
    html,
    seo: analyzeSeo(html),
  };
}

function summarizeAssets(files: FileEntry[]): ArtifactAssetSummary {
  const byType: ArtifactAssetSummary["byType"] = {
    html: { ...EMPTY_TYPE_SUMMARY },
    javascript: { ...EMPTY_TYPE_SUMMARY },
    css: { ...EMPTY_TYPE_SUMMARY },
    images: { ...EMPTY_TYPE_SUMMARY },
    fonts: { ...EMPTY_TYPE_SUMMARY },
    maps: { ...EMPTY_TYPE_SUMMARY },
    other: { ...EMPTY_TYPE_SUMMARY },
  };

  for (const file of files) {
    const bucket = classifyFile(file.path);
    byType[bucket].count += 1;
    byType[bucket].totalSize += file.size;
  }

  return {
    totalFiles: files.length,
    totalSize: files.reduce((sum, file) => sum + file.size, 0),
    byType,
    largestFiles: [...files]
      .sort((a, b) => b.size - a.size)
      .slice(0, 5)
      .map((file) => ({ path: file.path, size: file.size })),
  };
}

function classifyFile(path: string): keyof ArtifactAssetSummary["byType"] {
  const ext = extname(path.toLowerCase());

  if (ext === ".html" || ext === ".htm") return "html";
  if (ext === ".js" || ext === ".mjs" || ext === ".cjs") return "javascript";
  if (ext === ".css") return "css";
  if (ext === ".map") return "maps";
  if ([".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".svg", ".ico"].includes(ext)) return "images";
  if ([".woff", ".woff2", ".ttf", ".otf", ".eot"].includes(ext)) return "fonts";
  return "other";
}

function analyzeHtml(html: string): ArtifactHtmlMetadata {
  return {
    title: normalizeText(matchFirst(html, /<title[^>]*>([\s\S]*?)<\/title>/i)),
    description: normalizeText(matchMetaContent(html, "name", "description")),
    hasViewport: hasMeta(html, "name", "viewport"),
    hasCanonical: /<link\s+[^>]*rel=["'][^"']*\bcanonical\b[^"']*["'][^>]*>/i.test(html),
    hasOpenGraph: /<meta\s+[^>]*property=["']og:/i.test(html),
    hasTwitterCard: /<meta\s+[^>]*name=["']twitter:/i.test(html),
    hasFavicon: /<link\s+[^>]*rel=["'][^"']*(?:\bicon\b|shortcut icon)[^"']*["'][^>]*>/i.test(html),
    lang: normalizeText(matchFirst(html, /<html\s+[^>]*lang=["']([^"']+)["'][^>]*>/i)),
  };
}

function analyzeSeo(html: ArtifactHtmlMetadata): ArtifactSeoSummary {
  const checks: ArtifactSeoCheck[] = [
    html.title
      ? { code: "SEO_TITLE_PRESENT", status: "pass" }
      : { code: "SEO_TITLE_MISSING", status: "warning" },
    html.description
      ? { code: "SEO_DESCRIPTION_PRESENT", status: "pass" }
      : { code: "SEO_DESCRIPTION_MISSING", status: "warning" },
    html.hasViewport
      ? { code: "SEO_VIEWPORT_PRESENT", status: "pass" }
      : { code: "SEO_VIEWPORT_MISSING", status: "warning" },
    html.hasCanonical
      ? { code: "SEO_CANONICAL_PRESENT", status: "pass" }
      : { code: "SEO_CANONICAL_MISSING", status: "warning" },
    html.hasOpenGraph
      ? { code: "SEO_OPEN_GRAPH_PRESENT", status: "pass" }
      : { code: "SEO_OPEN_GRAPH_MISSING", status: "warning" },
    html.hasFavicon
      ? { code: "SEO_FAVICON_PRESENT", status: "pass" }
      : { code: "SEO_FAVICON_MISSING", status: "warning" },
  ];

  const passed = checks.filter((check) => check.status === "pass").length;
  return {
    score: Math.round((passed / checks.length) * 100),
    checks,
  };
}

function readTextFile(absPath: string): string {
  try {
    return readFileSync(absPath, "utf-8");
  } catch {
    return "";
  }
}

function matchMetaContent(html: string, attr: "name" | "property", value: string): string | null {
  const escapedValue = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`<meta\\s+[^>]*${attr}=["']${escapedValue}["'][^>]*content=["']([^"']*)["'][^>]*>`, "i");
  const reversedPattern = new RegExp(`<meta\\s+[^>]*content=["']([^"']*)["'][^>]*${attr}=["']${escapedValue}["'][^>]*>`, "i");
  return matchFirst(html, pattern) ?? matchFirst(html, reversedPattern);
}

function hasMeta(html: string, attr: "name" | "property", value: string): boolean {
  const escapedValue = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`<meta\\s+[^>]*${attr}=["']${escapedValue}["'][^>]*>`, "i").test(html);
}

function matchFirst(value: string, pattern: RegExp): string | null {
  return pattern.exec(value)?.[1] ?? null;
}

function normalizeText(value: string | null): string | null {
  const normalized = value?.replace(/\s+/g, " ").trim() ?? "";
  return normalized.length > 0 ? normalized : null;
}
