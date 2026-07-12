export interface ReleaseReportIssue {
  level: "info" | "warning" | "failed";
  code: string;
}

export interface ReleaseReportSeoCheck {
  code: string;
  status: "pass" | "warning";
}

export interface ReleaseReportRuntime {
  level: "pass" | "warning" | "failed";
  url: string | null;
  status: number | null;
  consoleErrorCount: number;
  failedRequestCount: number;
  items: ReleaseReportIssue[];
}

export interface ReleaseReportAssetType {
  type: string;
  count: number;
  totalSize: number;
}

export interface ReleaseReportFileSummary {
  path: string;
  size: number;
}

export interface ReleaseReport {
  level: "pass" | "warning" | "failed" | "unknown";
  entrypoint: string | null;
  totalFiles: number;
  totalSize: number;
  assetTypes: ReleaseReportAssetType[];
  largestFiles: ReleaseReportFileSummary[];
  htmlTitle: string | null;
  htmlDescription: string | null;
  htmlLang: string | null;
  seoScore: number | null;
  seoChecks: ReleaseReportSeoCheck[];
  issues: ReleaseReportIssue[];
  runtime: ReleaseReportRuntime | null;
}

export interface ReleaseGateSummary {
  level: ReleaseReport["level"];
  failedCount: number;
  warningCount: number;
  seoScore: number | null;
  runtimeLevel: ReleaseReportRuntime["level"] | "unknown";
  topIssues: ReleaseReportIssue[];
}

export function parseReleaseReport(detectResult: Record<string, unknown>): ReleaseReport {
  const insights = readRecord(detectResult.insights);
  const assets = readRecord(insights?.assets);
  const seo = readRecord(insights?.seo);
  const html = readRecord(insights?.html);
  const runtime = readRuntime(detectResult.runtime);

  return {
    level: readLevel(detectResult.level),
    entrypoint: readString(insights?.entrypoint),
    totalFiles: readNumber(assets?.totalFiles),
    totalSize: readNumber(assets?.totalSize),
    assetTypes: readAssetTypes(assets?.byType),
    largestFiles: Array.isArray(assets?.largestFiles) ? assets.largestFiles.flatMap(readFileSummary) : [],
    htmlTitle: readString(html?.title),
    htmlDescription: readString(html?.description),
    htmlLang: readString(html?.lang),
    seoScore: typeof seo?.score === "number" && Number.isFinite(seo.score) ? seo.score : null,
    seoChecks: Array.isArray(seo?.checks) ? seo.checks.flatMap(readSeoCheck) : [],
    issues: Array.isArray(detectResult.items) ? detectResult.items.flatMap(readIssue) : [],
    runtime,
  };
}

export function summarizeReleaseGate(report: ReleaseReport): ReleaseGateSummary {
  const allIssues = [...report.issues, ...(report.runtime?.items ?? [])];

  return {
    level: report.level,
    failedCount: allIssues.filter((issue) => issue.level === "failed").length,
    warningCount:
      allIssues.filter((issue) => issue.level === "warning").length +
      report.seoChecks.filter((check) => check.status === "warning").length,
    seoScore: report.seoScore,
    runtimeLevel: report.runtime?.level ?? "unknown",
    topIssues: allIssues.filter((issue) => issue.level === "failed" || issue.level === "warning").slice(0, 3),
  };
}

function readAssetTypes(value: unknown): ReleaseReportAssetType[] {
  const byType = readRecord(value);

  if (!byType) {
    return [];
  }

  return Object.entries(byType)
    .flatMap(([type, summary]) => {
      const item = readRecord(summary);
      const count = readNumber(item?.count);
      const totalSize = readNumber(item?.totalSize);

      return count > 0 || totalSize > 0 ? [{ type, count, totalSize }] : [];
    })
    .sort((a, b) => b.totalSize - a.totalSize);
}

function readFileSummary(value: unknown): ReleaseReportFileSummary[] {
  const item = readRecord(value);
  const path = readString(item?.path);
  const size = readNumber(item?.size);

  return path ? [{ path, size }] : [];
}

function readRuntime(value: unknown): ReleaseReportRuntime | null {
  const runtime = readRecord(value);
  const level = readRuntimeLevel(runtime?.level);

  if (!runtime || !level) {
    return null;
  }

  const snapshot = readRecord(runtime.snapshot);
  const consoleMessages = Array.isArray(snapshot?.consoleMessages) ? snapshot.consoleMessages : [];
  const failedRequests = Array.isArray(snapshot?.failedRequests) ? snapshot.failedRequests : [];

  return {
    level,
    url: readString(runtime.url),
    status: readNullableNumber(snapshot?.status),
    consoleErrorCount: consoleMessages.filter(isConsoleErrorMessage).length,
    failedRequestCount: failedRequests.length,
    items: Array.isArray(runtime.items) ? runtime.items.flatMap(readIssue) : [],
  };
}

function isConsoleErrorMessage(value: unknown): boolean {
  const message = readRecord(value);
  return message?.type === "error";
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
    ? (value as Record<string, unknown>)
    : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function readNullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readLevel(value: unknown): ReleaseReport["level"] {
  return value === "pass" || value === "warning" || value === "failed" ? value : "unknown";
}

function readRuntimeLevel(value: unknown): ReleaseReportRuntime["level"] | null {
  return value === "pass" || value === "warning" || value === "failed" ? value : null;
}

function readIssueLevel(value: unknown): ReleaseReportIssue["level"] | null {
  return value === "info" || value === "warning" || value === "failed" ? value : null;
}
