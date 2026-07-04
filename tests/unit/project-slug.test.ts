import { describe, expect, test } from "bun:test";
import { isValidProjectSlug } from "@zipship/deploy-core";

describe("project slug validation", () => {
  test("accepts lowercase slugs with numbers, hyphens, and underscores", () => {
    expect(isValidProjectSlug("admin")).toBe(true);
    expect(isValidProjectSlug("admin-v2")).toBe(true);
    expect(isValidProjectSlug("admin_v2")).toBe(true);
  });

  test("rejects invalid or reserved slugs", () => {
    expect(isValidProjectSlug("_admin")).toBe(false);
    expect(isValidProjectSlug("Admin")).toBe(false);
    expect(isValidProjectSlug("_api")).toBe(false);
    expect(isValidProjectSlug("favicon.ico")).toBe(false);
  });
});
