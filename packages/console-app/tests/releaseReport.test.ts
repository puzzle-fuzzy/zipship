import { describe, expect, it } from "vitest";
import { parseReleaseReport, summarizeReleaseGate } from "../src/features/project-detail/releaseReport";

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
      runtime: {
        level: "warning",
        url: "http://localhost:5007/_sites/demo/release-1/",
        snapshot: {
          finalUrl: "http://localhost:5007/_sites/demo/release-1/",
          status: 200,
          bodyText: "Demo",
          consoleMessages: [
            { type: "error", text: "boom" },
            { type: "warning", text: "heads up" },
          ],
          failedRequests: [{ url: "/missing.js", failureText: "net::ERR_FAILED" }],
        },
        items: [
          { level: "info", code: "RUNTIME_PAGE_LOADED" },
          { level: "warning", code: "RUNTIME_CONSOLE_ERRORS" },
        ],
      },
    });

    expect(report.level).toBe("warning");
    expect(report.entrypoint).toBe("index.html");
    expect(report.totalFiles).toBe(3);
    expect(report.totalSize).toBe(4096);
    expect(report.assetTypes).toEqual([
      { type: "javascript", count: 1, totalSize: 2048 },
      { type: "css", count: 1, totalSize: 1536 },
      { type: "html", count: 1, totalSize: 512 },
    ]);
    expect(report.largestFiles).toEqual([{ path: "assets/index.js", size: 2048 }]);
    expect(report.htmlTitle).toBe("Demo");
    expect(report.htmlLang).toBe("en");
    expect(report.seoScore).toBe(67);
    expect(report.issues).toEqual([{ level: "warning", code: "SEO_DESCRIPTION_MISSING" }]);
    expect(report.runtime).toMatchObject({
      level: "warning",
      status: 200,
      consoleErrorCount: 1,
      failedRequestCount: 1,
      items: [
        { level: "info", code: "RUNTIME_PAGE_LOADED" },
        { level: "warning", code: "RUNTIME_CONSOLE_ERRORS" },
      ],
    });
  });

  it("returns safe defaults for older releases without insights", () => {
    const report = parseReleaseReport({ level: "pass", items: [] });

    expect(report.level).toBe("pass");
    expect(report.entrypoint).toBeNull();
    expect(report.totalFiles).toBe(0);
    expect(report.totalSize).toBe(0);
    expect(report.seoScore).toBeNull();
    expect(report.seoChecks).toEqual([]);
    expect(report.runtime).toBeNull();
  });

  it("summarizes pre-publish quality gate signals", () => {
    const report = parseReleaseReport({
      level: "failed",
      items: [{ level: "failed", code: "MISSING_INDEX_HTML" }],
      insights: {
        seo: {
          score: 42,
          checks: [{ code: "SEO_DESCRIPTION_MISSING", status: "warning" }],
        },
      },
      runtime: {
        level: "warning",
        snapshot: {
          status: 200,
          consoleMessages: [{ type: "error", text: "boom" }],
          failedRequests: [],
        },
        items: [{ level: "warning", code: "RUNTIME_CONSOLE_ERRORS" }],
      },
    });

    expect(summarizeReleaseGate(report)).toMatchObject({
      level: "failed",
      failedCount: 1,
      warningCount: 2,
      seoScore: 42,
      runtimeLevel: "warning",
      topIssues: [
        { level: "failed", code: "MISSING_INDEX_HTML" },
        { level: "warning", code: "RUNTIME_CONSOLE_ERRORS" },
      ],
    });
  });
});
