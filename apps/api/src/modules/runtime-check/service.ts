export type RuntimeCheckLevel = "pass" | "warning" | "failed";

export interface RuntimeConsoleMessage {
  type: "error" | "warning" | "info" | "log";
  text: string;
}

export interface RuntimeFailedRequest {
  url: string;
  status: number | null;
  errorText: string | null;
}

export interface RuntimePageSnapshot {
  finalUrl: string;
  status: number | null;
  bodyText: string;
  consoleMessages: RuntimeConsoleMessage[];
  failedRequests: RuntimeFailedRequest[];
}

export interface RuntimeCheckItem {
  level: "info" | "warning" | "failed";
  code: string;
  details?: Record<string, unknown>;
}

export interface RuntimeCheckResult {
  level: RuntimeCheckLevel;
  checkedAt: string;
  url: string;
  snapshot: RuntimePageSnapshot;
  items: RuntimeCheckItem[];
}

export interface RuntimePageProbe {
  probe(url: string): Promise<RuntimePageSnapshot>;
}

export interface RuntimeCheckServiceOptions {
  probe: RuntimePageProbe;
  now: () => Date;
  minVisibleTextLength?: number;
}

export class RuntimeCheckService {
  constructor(private readonly options: RuntimeCheckServiceOptions) {}

  async check(url: string): Promise<RuntimeCheckResult> {
    const snapshot = await this.options.probe.probe(url);
    const items = evaluateSnapshot(snapshot, {
      minVisibleTextLength: this.options.minVisibleTextLength ?? 1,
    });

    return {
      level: summarizeLevel(items),
      checkedAt: this.options.now().toISOString(),
      url,
      snapshot,
      items,
    };
  }
}

function evaluateSnapshot(
  snapshot: RuntimePageSnapshot,
  options: { minVisibleTextLength: number },
): RuntimeCheckItem[] {
  const items: RuntimeCheckItem[] = [];

  if (snapshot.status !== null && (snapshot.status < 200 || snapshot.status >= 400)) {
    items.push({
      level: "failed",
      code: "RUNTIME_HTTP_STATUS_FAILED",
      details: { status: snapshot.status },
    });
  }

  if (snapshot.bodyText.trim().length < options.minVisibleTextLength) {
    items.push({ level: "failed", code: "RUNTIME_BLANK_PAGE" });
  }

  const consoleErrors = snapshot.consoleMessages.filter((message) => message.type === "error");
  if (consoleErrors.length > 0) {
    items.push({
      level: "warning",
      code: "RUNTIME_CONSOLE_ERRORS",
      details: {
        count: consoleErrors.length,
        samples: consoleErrors.slice(0, 5).map((message) => message.text),
      },
    });
  }

  if (snapshot.failedRequests.length > 0) {
    items.push({
      level: "warning",
      code: "RUNTIME_FAILED_REQUESTS",
      details: {
        count: snapshot.failedRequests.length,
        samples: snapshot.failedRequests.slice(0, 5),
      },
    });
  }

  if (items.length === 0) {
    items.push({ level: "info", code: "RUNTIME_PAGE_LOADED" });
  }

  return items;
}

function summarizeLevel(items: RuntimeCheckItem[]): RuntimeCheckLevel {
  if (items.some((item) => item.level === "failed")) return "failed";
  if (items.some((item) => item.level === "warning")) return "warning";
  return "pass";
}
