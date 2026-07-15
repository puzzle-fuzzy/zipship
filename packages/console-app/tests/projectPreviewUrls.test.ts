import { describe, expect, it } from "vitest";
import { buildSitePreviewUrl } from "../src/features/project-detail/projectPreviewUrls";

describe("project preview URLs", () => {
  it("builds internal site preview URLs from the API base URL", () => {
    expect(buildSitePreviewUrl("http://localhost:5007/", "demo", "release-1")).toBe(
      "http://localhost:5007/_sites/demo/release-1/",
    );
  });

  it("normalizes API base URLs without a trailing slash", () => {
    expect(buildSitePreviewUrl("http://localhost:5007", "demo", "release-1")).toBe(
      "http://localhost:5007/_sites/demo/release-1/",
    );
  });
});
