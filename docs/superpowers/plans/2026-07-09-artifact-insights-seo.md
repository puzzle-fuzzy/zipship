# Artifact Insights And SEO Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a first-stage artifact report that helps frontend users understand whether their uploaded Vite/static build is deployable, what it contains, and whether its basic SEO metadata is ready.

**Architecture:** Keep the analysis inside `packages/deploy-core`, because release processing already extracts and normalizes the artifact root there. Persist the report inside the existing `releases.detectResult` JSON so the first stage needs no database migration, then render it in the console version list as an expandable report.

**Tech Stack:** Bun, TypeScript, Elysia, Drizzle JSONB, React 19, Zustand, Tailwind CSS v4, lucide-react, Bun test.

## Global Constraints

- Do not change the upload API shape except by enriching existing `detectResult` JSON returned in release list responses.
- Keep `manifest` content-addressed and deterministic; do not put non-file-analysis metadata into `manifest`.
- Services still return stable error `code` strings only; user-facing report text lives in the frontend i18n maps.
- SEO analysis in this plan is static HTML analysis only. Browser rendering, screenshots, console errors, and Lighthouse-style runtime checks are a separate phase.
- Detection codes must be stable strings that can be mapped in the frontend.
- Preserve current behavior: failed-level detection still marks the release as failed; warning/info detection still allows the release to become ready.

---

## File Structure

- Modify `packages/deploy-core/src/types.ts`
  - Add `ArtifactInsights`, `ArtifactSeoCheck`, `ArtifactHtmlMetadata`, and asset summary types.
  - Add optional `insights?: ArtifactInsights` to `DetectResult`.

- Create `packages/deploy-core/src/insights.ts`
  - Analyze normalized `FileEntry[]` and `index.html`.
  - Produce basic artifact facts, asset size summary, HTML metadata, and SEO checks.

- Modify `packages/deploy-core/src/detect.ts`
  - Import `buildArtifactInsights`.
  - Attach `insights` to the returned `DetectResult`.
  - Optionally add warning items for important SEO blockers while keeping SEO details in `insights`.

- Modify `packages/deploy-core/src/index.ts`
  - No behavioral rewrite; `processRelease()` already persists `result.detect`.
  - Ensure exported types include the new insight types through `export type * from "./types"`.

- Modify `packages/deploy-core/tests/unit/detect.test.ts`
  - Add tests for SEO metadata extraction and asset summary.
  - Add tests that static SEO warnings do not fail deployable releases.

- Modify `tests/integration/releases-routes.test.ts`
  - Assert release list exposes `detectResult.insights`.

- Create `packages/console-app/src/features/project-detail/releaseReport.ts`
  - Parse unknown `detectResult` safely into view-friendly report data.
  - Map status counts, SEO score, and top issues.

- Create `packages/console-app/src/features/project-detail/ProjectReleaseReport.tsx`
  - Render deployability, artifact basics, SEO checklist, and detection issues for one release.

- Modify `packages/console-app/src/features/project-detail/ProjectVersionsTab.tsx`
  - Add expandable report rows beneath each release.
  - Keep primary row compact.

- Modify `packages/console-app/src/i18n/en.ts`
  - Add English labels for report sections and detection/SEO codes.

- Modify `packages/console-app/src/i18n/zh.ts`
  - Add Chinese labels for report sections and detection/SEO codes.

- Add or modify `packages/console-app/tests/releaseReport.test.ts`
  - Unit test parser behavior for complete and partial reports.

- Add or modify `packages/console-app/tests/ProjectVersionsTab.test.tsx`
  - Verify expanding a version shows artifact info and SEO checks.

---

### Task 1: Add Artifact Insights In Deploy Core

**Files:**
- Modify: `packages/deploy-core/src/types.ts`
- Create: `packages/deploy-core/src/insights.ts`
- Modify: `packages/deploy-core/src/detect.ts`
- Test: `packages/deploy-core/tests/unit/detect.test.ts`

**Interfaces:**
- Consumes: `FileEntry[]` from `resolveArtifactRoot()`.
- Produces:
  - `buildArtifactInsights(files: FileEntry[]): Promise<ArtifactInsights>`
  - `DetectResult.insights?: ArtifactInsights`

- [ ] **Step 1: Write failing tests for metadata and SEO insights**

Append to `packages/deploy-core/tests/unit/detect.test.ts`:

```ts
test("extracts artifact insights from index.html", async () => {
  const files = [
    makeFile(
      "index.html",
      [
        "<!doctype html>",
        "<html>",
        "<head>",
        '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
        "<title>ZipShip Demo</title>",
        '<meta name="description" content="A small deployable demo site for ZipShip.">',
        '<link rel="canonical" href="https://example.com/">',
        '<meta property="og:title" content="ZipShip Demo">',
        '<meta property="og:description" content="A small deployable demo site for ZipShip.">',
        '<link rel="icon" href="./favicon.ico">',
        "</head>",
        "<body><div id=\"root\"></div><script type=\"module\" src=\"./assets/index.js\"></script></body>",
        "</html>",
      ].join(""),
    ),
    makeFile("assets/index.js", "console.log('ok');"),
    makeFile("assets/style.css", "body { color: #111; }"),
    makeFile("favicon.ico", "ico"),
  ];

  const result = await runDetection(files);

  expect(result.level).toBe("pass");
  expect(result.insights?.entrypoint).toBe("index.html");
  expect(result.insights?.html.title).toBe("ZipShip Demo");
  expect(result.insights?.html.description).toBe("A small deployable demo site for ZipShip.");
  expect(result.insights?.html.hasViewport).toBe(true);
  expect(result.insights?.html.hasCanonical).toBe(true);
  expect(result.insights?.html.hasOpenGraph).toBe(true);
  expect(result.insights?.html.hasFavicon).toBe(true);
  expect(result.insights?.assets.byType.javascript.count).toBe(1);
  expect(result.insights?.assets.byType.css.count).toBe(1);
  expect(result.insights?.seo.score).toBe(100);
  expect(result.insights?.seo.checks.every((check) => check.status === "pass")).toBe(true);
});

test("reports SEO warnings without failing the release", async () => {
  const files = [
    makeFile("index.html", "<html><head><title></title></head><body>Hello</body></html>"),
  ];

  const result = await runDetection(files);

  expect(result.level).toBe("warning");
  expect(result.items.some((item) => item.code === "SEO_TITLE_MISSING")).toBe(true);
  expect(result.items.some((item) => item.code === "SEO_DESCRIPTION_MISSING")).toBe(true);
  expect(result.items.some((item) => item.code === "SEO_VIEWPORT_MISSING")).toBe(true);
  expect(result.insights?.seo.score).toBeLessThan(100);
  expect(result.insights?.seo.checks.some((check) => check.code === "SEO_TITLE_MISSING")).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
bun test packages/deploy-core/tests/unit/detect.test.ts
```

Expected: FAIL because `DetectResult.insights` does not exist and SEO codes are not produced.

- [ ] **Step 3: Add insight types**

Modify `packages/deploy-core/src/types.ts`:

```ts
export interface ArtifactAssetTypeSummary {
  count: number;
  totalSize: number;
}

export interface ArtifactAssetSummary {
  totalFiles: number;
  totalSize: number;
  byType: {
    html: ArtifactAssetTypeSummary;
    javascript: ArtifactAssetTypeSummary;
    css: ArtifactAssetTypeSummary;
    images: ArtifactAssetTypeSummary;
    fonts: ArtifactAssetTypeSummary;
    maps: ArtifactAssetTypeSummary;
    other: ArtifactAssetTypeSummary;
  };
  largestFiles: Array<{
    path: string;
    size: number;
  }>;
}

export interface ArtifactHtmlMetadata {
  title: string | null;
  description: string | null;
  hasViewport: boolean;
  hasCanonical: boolean;
  hasOpenGraph: boolean;
  hasTwitterCard: boolean;
  hasFavicon: boolean;
  lang: string | null;
}

export interface ArtifactSeoCheck {
  code: string;
  status: "pass" | "warning";
  details?: Record<string, unknown>;
}

export interface ArtifactSeoSummary {
  score: number;
  checks: ArtifactSeoCheck[];
}

export interface ArtifactInsights {
  entrypoint: string | null;
  assets: ArtifactAssetSummary;
  html: ArtifactHtmlMetadata;
  seo: ArtifactSeoSummary;
}
```

Then change `DetectResult` in the same file:

```ts
export interface DetectResult {
  level: "pass" | "warning" | "failed";
  items: DetectItem[];
  insights?: ArtifactInsights;
}
```

- [ ] **Step 4: Implement `buildArtifactInsights`**

Create `packages/deploy-core/src/insights.ts`:

```ts
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
  const seo = analyzeSeo(html);

  return {
    entrypoint: indexHtml?.path ?? null,
    assets: summarizeAssets(files),
    html,
    seo,
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
  const lower = path.toLowerCase();
  const ext = extname(lower);

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
    description: normalizeText(matchFirst(html, /<meta\s+[^>]*name=["']description["'][^>]*content=["']([^"']*)["'][^>]*>/i)),
    hasViewport: /<meta\s+[^>]*name=["']viewport["'][^>]*>/i.test(html),
    hasCanonical: /<link\s+[^>]*rel=["']canonical["'][^>]*>/i.test(html),
    hasOpenGraph: /<meta\s+[^>]*property=["']og:/i.test(html),
    hasTwitterCard: /<meta\s+[^>]*name=["']twitter:/i.test(html),
    hasFavicon: /<link\s+[^>]*rel=["'][^"']*(?:icon|shortcut icon)[^"']*["'][^>]*>/i.test(html),
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

function matchFirst(value: string, pattern: RegExp): string | null {
  return pattern.exec(value)?.[1] ?? null;
}

function normalizeText(value: string | null): string | null {
  const normalized = value?.replace(/\s+/g, " ").trim() ?? "";
  return normalized.length > 0 ? normalized : null;
}
```

- [ ] **Step 5: Attach insights and SEO warning items in detection**

Modify `packages/deploy-core/src/detect.ts`.

Add import:

```ts
import { buildArtifactInsights } from "./insights";
```

Inside `runDetection()`, after the referenced assets check and before computing overall level:

```ts
  const insights = await buildArtifactInsights(files);
  allItems.push(...insights.seo.checks
    .filter((check) => check.status === "warning")
    .map((check) => ({ level: "warning" as const, code: check.code, details: check.details })));
```

Change the return:

```ts
  return { level, items: allItems, insights };
```

- [ ] **Step 6: Run deploy-core tests**

Run:

```bash
bun test packages/deploy-core/tests/unit/detect.test.ts packages/deploy-core/tests/unit/pipeline.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/deploy-core/src/types.ts packages/deploy-core/src/insights.ts packages/deploy-core/src/detect.ts packages/deploy-core/tests/unit/detect.test.ts
git commit -m "feat: add artifact insights to detection"
```

---

### Task 2: Verify Release API Exposes Insights

**Files:**
- Test: `tests/integration/releases-routes.test.ts`

**Interfaces:**
- Consumes: `Release.detectResult` returned by `GET /_api/projects/:projectId/releases`.
- Produces: release list contract includes `detectResult.insights`.

- [ ] **Step 1: Add release contract assertion**

In `tests/integration/releases-routes.test.ts`, find the test that uploads `valid-vite-relative-base.zip` and asserts `detectResult.level`. Add:

```ts
const insights = release.detectResult as {
  insights?: {
    entrypoint: string | null;
    assets: {
      totalFiles: number;
      totalSize: number;
    };
    html: {
      title: string | null;
      hasViewport: boolean;
    };
    seo: {
      score: number;
      checks: Array<{ code: string; status: string }>;
    };
  };
};

expect(insights.insights?.entrypoint).toBe("index.html");
expect(insights.insights?.assets.totalFiles).toBeGreaterThan(0);
expect(insights.insights?.seo.checks.length).toBeGreaterThan(0);
```

- [ ] **Step 2: Run release integration test**

Run:

```bash
TEST_DATABASE_URL=postgres://zipship:zipship@localhost:5432/zipship_test bun test tests/integration/releases-routes.test.ts
```

Expected: PASS after Task 1. If PostgreSQL is not running, first run:

```bash
bun run db:up
bun run db:create-test
DATABASE_URL=postgres://zipship:zipship@localhost:5432/zipship_test bun run db:migrate
```

- [ ] **Step 3: Commit**

```bash
git add tests/integration/releases-routes.test.ts
git commit -m "test: expose release artifact insights"
```

---

### Task 3: Add Frontend Report Parser

**Files:**
- Create: `packages/console-app/src/features/project-detail/releaseReport.ts`
- Test: `packages/console-app/tests/releaseReport.test.ts`

**Interfaces:**
- Consumes: `Release.detectResult: Record<string, unknown>`.
- Produces:
  - `parseReleaseReport(detectResult: Record<string, unknown>): ReleaseReport`
  - `ReleaseReport` with safe defaults for missing insight data.

- [ ] **Step 1: Write parser tests**

Create `packages/console-app/tests/releaseReport.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { parseReleaseReport } from "../src/features/project-detail/releaseReport";

describe("parseReleaseReport", () => {
  it("parses complete artifact insights", () => {
    const report = parseReleaseReport({
      level: "warning",
      items: [{ level: "warning", code: "SEO_DESCRIPTION_MISSING" }],
      insights: {
        entrypoint: "index.html",
        assets: {
          totalFiles: 3,
          totalSize: 4096,
          byType: {
            html: { count: 1, totalSize: 512 },
            javascript: { count: 1, totalSize: 2048 },
            css: { count: 1, totalSize: 1536 },
            images: { count: 0, totalSize: 0 },
            fonts: { count: 0, totalSize: 0 },
            maps: { count: 0, totalSize: 0 },
            other: { count: 0, totalSize: 0 },
          },
          largestFiles: [{ path: "assets/index.js", size: 2048 }],
        },
        html: {
          title: "Demo",
          description: null,
          hasViewport: true,
          hasCanonical: false,
          hasOpenGraph: false,
          hasTwitterCard: false,
          hasFavicon: true,
          lang: "en",
        },
        seo: {
          score: 67,
          checks: [
            { code: "SEO_TITLE_PRESENT", status: "pass" },
            { code: "SEO_DESCRIPTION_MISSING", status: "warning" },
          ],
        },
      },
    });

    expect(report.level).toBe("warning");
    expect(report.entrypoint).toBe("index.html");
    expect(report.totalFiles).toBe(3);
    expect(report.seoScore).toBe(67);
    expect(report.issues).toEqual([{ level: "warning", code: "SEO_DESCRIPTION_MISSING" }]);
  });

  it("returns safe defaults for older releases without insights", () => {
    const report = parseReleaseReport({ level: "pass", items: [] });

    expect(report.level).toBe("pass");
    expect(report.entrypoint).toBeNull();
    expect(report.totalFiles).toBe(0);
    expect(report.totalSize).toBe(0);
    expect(report.seoScore).toBeNull();
    expect(report.seoChecks).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
bun --filter @zipship/console-app test releaseReport.test.ts
```

Expected: FAIL because `releaseReport.ts` does not exist.

- [ ] **Step 3: Implement parser**

Create `packages/console-app/src/features/project-detail/releaseReport.ts`:

```ts
export interface ReleaseReportIssue {
  level: "info" | "warning" | "failed";
  code: string;
}

export interface ReleaseReportSeoCheck {
  code: string;
  status: "pass" | "warning";
}

export interface ReleaseReport {
  level: "pass" | "warning" | "failed" | "unknown";
  entrypoint: string | null;
  totalFiles: number;
  totalSize: number;
  seoScore: number | null;
  seoChecks: ReleaseReportSeoCheck[];
  issues: ReleaseReportIssue[];
}

export function parseReleaseReport(detectResult: Record<string, unknown>): ReleaseReport {
  const level = readLevel(detectResult.level);
  const issues = Array.isArray(detectResult.items)
    ? detectResult.items.flatMap(readIssue)
    : [];

  const insights = readRecord(detectResult.insights);
  const assets = readRecord(insights?.assets);
  const seo = readRecord(insights?.seo);

  return {
    level,
    entrypoint: readString(insights?.entrypoint),
    totalFiles: readNumber(assets?.totalFiles),
    totalSize: readNumber(assets?.totalSize),
    seoScore: typeof seo?.score === "number" ? seo.score : null,
    seoChecks: Array.isArray(seo?.checks) ? seo.checks.flatMap(readSeoCheck) : [],
    issues,
  };
}

function readIssue(value: unknown): ReleaseReportIssue[] {
  const item = readRecord(value);
  const level = readIssueLevel(item?.level);
  const code = readString(item?.code);
  return level && code ? [{ level, code }] : [];
}

function readSeoCheck(value: unknown): ReleaseReportSeoCheck[] {
  const item = readRecord(value);
  const code = readString(item?.code);
  const status = item?.status === "pass" || item?.status === "warning" ? item.status : null;
  return code && status ? [{ code, status }] : [];
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function readLevel(value: unknown): ReleaseReport["level"] {
  return value === "pass" || value === "warning" || value === "failed" ? value : "unknown";
}

function readIssueLevel(value: unknown): ReleaseReportIssue["level"] | null {
  return value === "info" || value === "warning" || value === "failed" ? value : null;
}
```

- [ ] **Step 4: Run parser tests**

Run:

```bash
bun --filter @zipship/console-app test releaseReport.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/console-app/src/features/project-detail/releaseReport.ts packages/console-app/tests/releaseReport.test.ts
git commit -m "feat: parse release artifact reports"
```

---

### Task 4: Render Expandable Release Reports

**Files:**
- Create: `packages/console-app/src/features/project-detail/ProjectReleaseReport.tsx`
- Modify: `packages/console-app/src/features/project-detail/ProjectVersionsTab.tsx`
- Modify: `packages/console-app/src/i18n/en.ts`
- Modify: `packages/console-app/src/i18n/zh.ts`
- Test: `packages/console-app/tests/ProjectVersionsTab.test.tsx`

**Interfaces:**
- Consumes: `parseReleaseReport(release.detectResult)`.
- Produces: visible report section per expanded release.

- [ ] **Step 1: Add UI test**

Create or extend `packages/console-app/tests/ProjectVersionsTab.test.tsx`:

```tsx
import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProjectVersionsTab } from "../src/features/project-detail/ProjectVersionsTab";

describe("ProjectVersionsTab release report", () => {
  it("expands a version and shows artifact and SEO report data", async () => {
    render(
      <ProjectVersionsTab
        loading={false}
        canManage={true}
        onUploadClick={() => {}}
        onPreview={() => {}}
        onPublish={async () => {}}
        releases={[
          {
            id: "release-1",
            projectId: "project-1",
            versionNumber: 1,
            releaseHash: "abcdef123456",
            previewUrl: "/_sites/demo/abcdef123456/",
            fullHash: "full",
            status: "ready",
            storagePath: "/tmp/site",
            rawUploadPath: "/tmp/upload.zip",
            fileCount: 3,
            totalSize: 4096,
            manifest: {},
            detectResult: {
              level: "warning",
              items: [{ level: "warning", code: "SEO_DESCRIPTION_MISSING" }],
              insights: {
                entrypoint: "index.html",
                assets: { totalFiles: 3, totalSize: 4096 },
                seo: {
                  score: 67,
                  checks: [{ code: "SEO_DESCRIPTION_MISSING", status: "warning" }],
                },
              },
            },
            createdBy: "user-1",
            createdAt: "2026-07-09T00:00:00.000Z",
            activatedAt: null,
            archivedAt: null,
          },
        ]}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: /report/i }));

    expect(screen.getByText(/index.html/i)).toBeInTheDocument();
    expect(screen.getByText(/67/)).toBeInTheDocument();
    expect(screen.getByText(/SEO_DESCRIPTION_MISSING/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run UI test to verify it fails**

Run:

```bash
bun --filter @zipship/console-app test ProjectVersionsTab.test.tsx
```

Expected: FAIL because the report button and panel do not exist.

- [ ] **Step 3: Create report component**

Create `packages/console-app/src/features/project-detail/ProjectReleaseReport.tsx`:

```tsx
import { AlertTriangle, CheckCircle2, FileCode2, Search } from "lucide-react";
import { useTranslation } from "../../i18n";
import { parseReleaseReport } from "./releaseReport";
import type { Release } from "../../stores/projectsStore";

interface ProjectReleaseReportProps {
  release: Release;
}

export function ProjectReleaseReport({ release }: ProjectReleaseReportProps) {
  const { t } = useTranslation();
  const report = parseReleaseReport(release.detectResult);

  return (
    <div className="grid gap-3 border-t bg-muted/20 px-3 py-3 text-sm md:grid-cols-3">
      <div className="flex items-start gap-2">
        <FileCode2 className="mt-0.5 size-4 text-muted-foreground" />
        <div>
          <div className="font-medium">{t("releaseReport.artifact")}</div>
          <div className="text-xs text-muted-foreground">
            {report.entrypoint ?? t("releaseReport.noEntrypoint")}
          </div>
          <div className="text-xs text-muted-foreground">
            {t("releaseReport.filesAndSize", {
              count: report.totalFiles,
              size: Math.round(report.totalSize / 1024),
            })}
          </div>
        </div>
      </div>

      <div className="flex items-start gap-2">
        <Search className="mt-0.5 size-4 text-muted-foreground" />
        <div>
          <div className="font-medium">{t("releaseReport.seo")}</div>
          <div className="text-xs text-muted-foreground">
            {report.seoScore === null
              ? t("releaseReport.noSeoScore")
              : t("releaseReport.seoScore", { score: report.seoScore })}
          </div>
          <div className="mt-1 flex flex-wrap gap-1">
            {report.seoChecks.slice(0, 4).map((check) => (
              <span
                key={check.code}
                className="inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px]"
              >
                {check.status === "pass" ? (
                  <CheckCircle2 className="size-3 text-green-600" />
                ) : (
                  <AlertTriangle className="size-3 text-amber-600" />
                )}
                {t(`releaseReport.codes.${check.code}`)}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 size-4 text-muted-foreground" />
        <div>
          <div className="font-medium">{t("releaseReport.issues")}</div>
          {report.issues.length === 0 ? (
            <div className="text-xs text-muted-foreground">{t("releaseReport.noIssues")}</div>
          ) : (
            <div className="mt-1 flex flex-wrap gap-1">
              {report.issues.slice(0, 5).map((issue) => (
                <span key={issue.code} className="rounded-md border px-1.5 py-0.5 text-[10px]">
                  {t(`releaseReport.codes.${issue.code}`)}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Add expandable report action**

Modify `packages/console-app/src/features/project-detail/ProjectVersionsTab.tsx`:

```tsx
import { BarChart3, MoreHorizontal, Plus } from "lucide-react";
import { useState } from "react";
import { ProjectReleaseReport } from "./ProjectReleaseReport";
```

Inside `ProjectVersionsTab`, add:

```tsx
const [expandedReleaseId, setExpandedReleaseId] = useState<string | null>(null);
```

Inside each release row actions, add a button before `DropdownMenu`:

```tsx
<Button
  variant="ghost"
  size="icon-sm"
  aria-label={t("releaseReport.toggle")}
  onClick={() => setExpandedReleaseId((current) => current === release.id ? null : release.id)}
>
  <BarChart3 className="size-4" />
</Button>
```

After the row div and before the separator:

```tsx
{expandedReleaseId === release.id && <ProjectReleaseReport release={release} />}
```

- [ ] **Step 5: Add i18n labels**

Add to `packages/console-app/src/i18n/en.ts`:

```ts
releaseReport: {
  toggle: "Report",
  artifact: "Artifact",
  noEntrypoint: "No entrypoint detected",
  filesAndSize: "{{count}} files · {{size}} KB",
  seo: "SEO",
  noSeoScore: "No SEO score",
  seoScore: "Score {{score}}",
  issues: "Issues",
  noIssues: "No issues detected",
  codes: {
    SEO_TITLE_PRESENT: "Title",
    SEO_TITLE_MISSING: "Missing title",
    SEO_DESCRIPTION_PRESENT: "Description",
    SEO_DESCRIPTION_MISSING: "Missing description",
    SEO_VIEWPORT_PRESENT: "Viewport",
    SEO_VIEWPORT_MISSING: "Missing viewport",
    SEO_CANONICAL_PRESENT: "Canonical",
    SEO_CANONICAL_MISSING: "Missing canonical",
    SEO_OPEN_GRAPH_PRESENT: "Open Graph",
    SEO_OPEN_GRAPH_MISSING: "Missing Open Graph",
    SEO_FAVICON_PRESENT: "Favicon",
    SEO_FAVICON_MISSING: "Missing favicon",
    ROOT_ASSET_PATH_DETECTED: "Root asset path",
    ROOT_PATH_REFERENCE_DETECTED: "Root path reference",
    RESERVED_PLATFORM_PATH_REFERENCED: "Platform path reference",
    SERVICE_WORKER_DETECTED: "Service worker",
    SOURCE_MAP_DETECTED: "Source map",
    REFERENCED_ASSETS_DIR_MISSING: "Missing assets folder",
    ENV_FILE_DETECTED: "Environment file",
    SECRET_FILE_DETECTED: "Secret file",
    GIT_DIR_DETECTED: "Git directory",
    MISSING_INDEX_HTML: "Missing index.html",
  },
},
```

Add to `packages/console-app/src/i18n/zh.ts`:

```ts
releaseReport: {
  toggle: "报告",
  artifact: "产物",
  noEntrypoint: "未检测到入口文件",
  filesAndSize: "{{count}} 个文件 · {{size}} KB",
  seo: "SEO",
  noSeoScore: "暂无 SEO 分数",
  seoScore: "得分 {{score}}",
  issues: "问题",
  noIssues: "未检测到问题",
  codes: {
    SEO_TITLE_PRESENT: "标题",
    SEO_TITLE_MISSING: "缺少标题",
    SEO_DESCRIPTION_PRESENT: "描述",
    SEO_DESCRIPTION_MISSING: "缺少描述",
    SEO_VIEWPORT_PRESENT: "Viewport",
    SEO_VIEWPORT_MISSING: "缺少 viewport",
    SEO_CANONICAL_PRESENT: "Canonical",
    SEO_CANONICAL_MISSING: "缺少 canonical",
    SEO_OPEN_GRAPH_PRESENT: "Open Graph",
    SEO_OPEN_GRAPH_MISSING: "缺少 Open Graph",
    SEO_FAVICON_PRESENT: "站点图标",
    SEO_FAVICON_MISSING: "缺少站点图标",
    ROOT_ASSET_PATH_DETECTED: "根路径资源引用",
    ROOT_PATH_REFERENCE_DETECTED: "根路径引用",
    RESERVED_PLATFORM_PATH_REFERENCED: "平台保留路径引用",
    SERVICE_WORKER_DETECTED: "Service Worker",
    SOURCE_MAP_DETECTED: "Source Map",
    REFERENCED_ASSETS_DIR_MISSING: "缺少 assets 目录",
    ENV_FILE_DETECTED: "环境变量文件",
    SECRET_FILE_DETECTED: "密钥文件",
    GIT_DIR_DETECTED: "Git 目录",
    MISSING_INDEX_HTML: "缺少 index.html",
  },
},
```

- [ ] **Step 6: Run frontend tests**

Run:

```bash
bun --filter @zipship/console-app test releaseReport.test.ts ProjectVersionsTab.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/console-app/src/features/project-detail/releaseReport.ts packages/console-app/src/features/project-detail/ProjectReleaseReport.tsx packages/console-app/src/features/project-detail/ProjectVersionsTab.tsx packages/console-app/src/i18n/en.ts packages/console-app/src/i18n/zh.ts packages/console-app/tests/releaseReport.test.ts packages/console-app/tests/ProjectVersionsTab.test.tsx
git commit -m "feat: show release artifact reports"
```

---

### Task 5: Final Validation And Existing Typecheck Debt

**Files:**
- Existing failures to inspect:
  - `tests/unit/invitations-service.test.ts`
  - `tests/unit/members-service.test.ts`
  - `tests/unit/webhooks-service.test.ts`

**Interfaces:**
- Consumes: all changes from Tasks 1-4.
- Produces: verified first-stage report feature and a clear note about any pre-existing typecheck debt.

- [ ] **Step 1: Run focused tests**

Run:

```bash
bun test packages/deploy-core/tests/unit/detect.test.ts packages/deploy-core/tests/unit/pipeline.test.ts
bun --filter @zipship/console-app test releaseReport.test.ts ProjectVersionsTab.test.tsx
TEST_DATABASE_URL=postgres://zipship:zipship@localhost:5432/zipship_test bun test tests/integration/releases-routes.test.ts
```

Expected: all focused tests PASS.

- [ ] **Step 2: Run root typecheck**

Run:

```bash
bun run typecheck
```

Expected right now: may FAIL on pre-existing test stub type issues in invitations, members, and webhooks tests. If the same failures remain, record them in the final implementation summary instead of mixing those fixes into this feature branch.

- [ ] **Step 3: Run full unit suite when typecheck debt is resolved**

Run:

```bash
bun run test:unit
```

Expected: PASS after unrelated typecheck debt is fixed.

- [ ] **Step 4: Commit final verification notes if docs changed**

Only if a verification note is added to docs:

```bash
git add docs/superpowers/plans/2026-07-09-artifact-insights-seo.md
git commit -m "docs: plan artifact insights rollout"
```

---

## Future Phase: Runtime Page Effect Checks

This first plan intentionally stops at static artifact and SEO analysis. The next separate plan should add:

- A background analysis job after release processing.
- Local preview server or direct file URL rendering with Playwright.
- Screenshot capture for desktop and mobile viewport.
- Console error collection.
- Basic render health checks: non-empty body, root element visible, no fatal JS error, main content appears above the fold.
- Persisted report location, likely `detectResult.runtime` at first or a new `release_checks` table if checks become asynchronous.

---

## Self-Review

**Spec coverage:** The plan covers upload artifact status, basic information, static SEO checks, and a user-facing report. It defers browser-rendered page effect checks to a separate phase because that is an independent asynchronous subsystem.

**Placeholder scan:** The plan contains no `TBD`, `TODO`, or unspecified implementation steps. Every code-changing step includes concrete code.

**Type consistency:** `DetectResult.insights`, `ArtifactInsights`, `parseReleaseReport()`, and `ProjectReleaseReport` use matching property names across backend and frontend tasks.
