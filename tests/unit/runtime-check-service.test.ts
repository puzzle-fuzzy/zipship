import { describe, expect, test } from "bun:test";
import {
  RuntimeCheckService,
  type RuntimePageSnapshot,
} from "../../apps/api/src/modules/runtime-check/service";

const NOW = new Date("2026-07-09T00:00:00.000Z");

function build(snapshot: RuntimePageSnapshot) {
  return new RuntimeCheckService({
    now: () => NOW,
    probe: {
      async probe() {
        return snapshot;
      },
    },
  });
}

function snapshot(overrides: Partial<RuntimePageSnapshot> = {}): RuntimePageSnapshot {
  return {
    finalUrl: "http://localhost/_sites/demo/abc123/",
    status: 200,
    bodyText: "Hello ZipShip",
    consoleMessages: [],
    failedRequests: [],
    ...overrides,
  };
}

describe("RuntimeCheckService", () => {
  test("passes when the page loads with visible text and no runtime issues", async () => {
    const result = await build(snapshot()).check("http://localhost/_sites/demo/abc123/");

    expect(result).toEqual({
      level: "pass",
      checkedAt: NOW.toISOString(),
      url: "http://localhost/_sites/demo/abc123/",
      snapshot: snapshot(),
      items: [{ level: "info", code: "RUNTIME_PAGE_LOADED" }],
    });
  });

  test("fails a blank page", async () => {
    const result = await build(snapshot({ bodyText: "   " })).check("http://localhost/blank");

    expect(result.level).toBe("failed");
    expect(result.items).toContainEqual({ level: "failed", code: "RUNTIME_BLANK_PAGE" });
  });

  test("fails non-successful document status", async () => {
    const result = await build(snapshot({ status: 404 })).check("http://localhost/missing");

    expect(result.level).toBe("failed");
    expect(result.items).toContainEqual({
      level: "failed",
      code: "RUNTIME_HTTP_STATUS_FAILED",
      details: { status: 404 },
    });
  });

  test("warns for console errors and failed requests", async () => {
    const result = await build(
      snapshot({
        consoleMessages: [
          { type: "error", text: "ReferenceError: app is not defined" },
          { type: "warning", text: "deprecated" },
        ],
        failedRequests: [
          { url: "http://localhost/assets/missing.js", status: 404, errorText: null },
        ],
      }),
    ).check("http://localhost/warn");

    expect(result.level).toBe("warning");
    expect(result.items).toContainEqual({
      level: "warning",
      code: "RUNTIME_CONSOLE_ERRORS",
      details: {
        count: 1,
        samples: ["ReferenceError: app is not defined"],
      },
    });
    expect(result.items).toContainEqual({
      level: "warning",
      code: "RUNTIME_FAILED_REQUESTS",
      details: {
        count: 1,
        samples: [{ url: "http://localhost/assets/missing.js", status: 404, errorText: null }],
      },
    });
  });
});
