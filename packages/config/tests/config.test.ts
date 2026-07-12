import { describe, expect, test } from "bun:test";
import { config } from "../src";

describe("config", () => {
  test("loads with sane defaults even with an empty environment", () => {
    expect(config.apiPort).toBeGreaterThan(0);
    expect(config.apiPort).toBeLessThanOrEqual(65535);
    expect(config.storageRoot.length).toBeGreaterThan(0);
    expect(config.databaseUrl.length).toBeGreaterThan(0);
  });

  test("appUrl is a valid URL (zod enforces the url() constraint)", () => {
    expect(() => new URL(config.appUrl)).not.toThrow();
  });

  test("smtp has a non-empty from address", () => {
    expect(config.smtp.from.length).toBeGreaterThan(0);
    expect(config.smtp.port).toBeGreaterThan(0);
  });
});
