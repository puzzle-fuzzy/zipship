import { describe, expect, it } from "vitest";
import { buildSitePreviewUrl } from "../src/features/project-detail/projectPreviewUrls";

describe("project preview URLs", () => {
  it("builds internal site preview URLs from the API base URL", () => {
    expect(buildSitePreviewUrl("http://localhost:3001/", "demo", "abcdef123456")).toBe(
      "http://localhost:3001/_sites/demo/abcdef123456/",
    );
  });

  it("normalizes API base URLs without a trailing slash", () => {
    expect(buildSitePreviewUrl("http://localhost:3001", "demo", "abcdef123456")).toBe(
      "http://localhost:3001/_sites/demo/abcdef123456/",
    );
  });
});
