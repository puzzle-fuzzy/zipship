import { chromium } from "playwright";
import type {
  RuntimeConsoleMessage,
  RuntimeFailedRequest,
  RuntimePageProbe,
  RuntimePageSnapshot,
} from "./service";

interface BrowserLike {
  newContext(options: { viewport: { width: number; height: number } }): Promise<BrowserContextLike>;
  close(): Promise<void>;
}

interface BrowserContextLike {
  newPage(): Promise<PageLike>;
  close(): Promise<void>;
}

interface PageLike {
  goto(url: string, options: { waitUntil: "load" | "domcontentloaded" | "networkidle"; timeout: number }): Promise<ResponseLike | null>;
  url(): string;
  locator(selector: string): LocatorLike;
  on(event: "console", handler: (message: ConsoleMessageLike) => void): void;
  on(event: "requestfailed", handler: (request: RequestLike) => void): void;
  on(event: "response", handler: (response: ResponseLike) => void): void;
}

interface LocatorLike {
  innerText(options: { timeout: number }): Promise<string>;
}

interface ConsoleMessageLike {
  type(): string;
  text(): string;
}

interface RequestLike {
  url(): string;
  failure(): { errorText: string } | null;
}

interface ResponseLike {
  url(): string;
  status(): number;
}

export interface PlaywrightPageProbeOptions {
  launchBrowser?: () => Promise<BrowserLike>;
  viewport?: { width: number; height: number };
  timeoutMs?: number;
  bodyTextTimeoutMs?: number;
  waitUntil?: "load" | "domcontentloaded" | "networkidle";
}

export class PlaywrightPageProbe implements RuntimePageProbe {
  constructor(private readonly options: PlaywrightPageProbeOptions = {}) {}

  async probe(url: string): Promise<RuntimePageSnapshot> {
    const browser = await this.launchBrowser();
    const context = await browser.newContext({
      viewport: this.options.viewport ?? { width: 1440, height: 1000 },
    });

    try {
      const page = await context.newPage();
      const consoleMessages: RuntimeConsoleMessage[] = [];
      const failedRequests: RuntimeFailedRequest[] = [];
      const recordedFailedUrls = new Set<string>();

      page.on("console", (message) => {
        consoleMessages.push({
          type: normalizeConsoleType(message.type()),
          text: message.text(),
        });
      });

      page.on("requestfailed", (request) => {
        const failed = {
          url: request.url(),
          status: null,
          errorText: request.failure()?.errorText ?? null,
        };
        recordedFailedUrls.add(failed.url);
        failedRequests.push(failed);
      });

      page.on("response", (response) => {
        const status = response.status();
        const responseUrl = response.url();
        if (status >= 400 && !recordedFailedUrls.has(responseUrl)) {
          failedRequests.push({ url: responseUrl, status, errorText: null });
        }
      });

      const response = await page.goto(url, {
        waitUntil: this.options.waitUntil ?? "networkidle",
        timeout: this.options.timeoutMs ?? 15_000,
      });
      const bodyText = await page
        .locator("body")
        .innerText({ timeout: this.options.bodyTextTimeoutMs ?? 1_000 })
        .catch(() => "");

      return {
        finalUrl: page.url(),
        status: response?.status() ?? null,
        bodyText,
        consoleMessages,
        failedRequests,
      };
    } finally {
      await context.close();
      await browser.close();
    }
  }

  private async launchBrowser(): Promise<BrowserLike> {
    if (this.options.launchBrowser) return this.options.launchBrowser();

    return chromium.launch({
      headless: true,
    }) as Promise<BrowserLike>;
  }
}

function normalizeConsoleType(type: string): RuntimeConsoleMessage["type"] {
  if (type === "error" || type === "warning" || type === "info" || type === "log") return type;
  return "log";
}
