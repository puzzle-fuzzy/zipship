import { describe, expect, test } from "bun:test";
import { PlaywrightPageProbe } from "../../apps/api/src/modules/runtime-check/playwright-probe";

type HandlerMap = {
  console: Array<(message: { type(): string; text(): string }) => void>;
  requestfailed: Array<(request: { url(): string; failure(): { errorText: string } | null }) => void>;
  response: Array<(response: { url(): string; status(): number }) => void>;
};

describe("PlaywrightPageProbe", () => {
  test("collects page status, body text, console errors, and failed requests", async () => {
    const handlers: HandlerMap = { console: [], requestfailed: [], response: [] };
    let contextClosed = false;
    let browserClosed = false;

    const probe = new PlaywrightPageProbe({
      launchBrowser: async () => ({
        async newContext() {
          return {
            async newPage() {
              return {
                on(event, handler) {
                  handlers[event].push(handler as never);
                },
                async goto() {
                  handlers.console[0]?.({
                    type: () => "error",
                    text: () => "ReferenceError: app is not defined",
                  });
                  handlers.requestfailed[0]?.({
                    url: () => "http://localhost/assets/missing.js",
                    failure: () => ({ errorText: "net::ERR_ABORTED" }),
                  });
                  handlers.response[0]?.({
                    url: () => "http://localhost/assets/missing.css",
                    status: () => 404,
                  });
                  return {
                    url: () => "http://localhost/_sites/demo/abc123/",
                    status: () => 200,
                  };
                },
                url() {
                  return "http://localhost/_sites/demo/abc123/";
                },
                locator() {
                  return {
                    async innerText() {
                      return "Hello ZipShip";
                    },
                  };
                },
              };
            },
            async close() {
              contextClosed = true;
            },
          };
        },
        async close() {
          browserClosed = true;
        },
      }),
    });

    const result = await probe.probe("http://localhost/_sites/demo/abc123/");

    expect(result).toEqual({
      finalUrl: "http://localhost/_sites/demo/abc123/",
      status: 200,
      bodyText: "Hello ZipShip",
      consoleMessages: [{ type: "error", text: "ReferenceError: app is not defined" }],
      failedRequests: [
        {
          url: "http://localhost/assets/missing.js",
          status: null,
          errorText: "net::ERR_ABORTED",
        },
        {
          url: "http://localhost/assets/missing.css",
          status: 404,
          errorText: null,
        },
      ],
    });
    expect(contextClosed).toBe(true);
    expect(browserClosed).toBe(true);
  });
});
