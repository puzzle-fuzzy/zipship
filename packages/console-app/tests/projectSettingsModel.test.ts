import { describe, expect, it } from "vitest";
import {
  buildAccessPlanePolicyPreview,
  buildProjectProductionPaths,
} from "../src/features/project-detail/projectSettingsModel";

describe("project settings model", () => {
  it("builds live and pinned production paths", () => {
    expect(buildProjectProductionPaths("demo", { id: "release-1" })).toEqual({
      livePath: "/demo/",
      pinnedPath: "/_sites/demo/release-1/",
    });
  });

  it("omits the pinned path when no release is active", () => {
    expect(buildProjectProductionPaths("demo", undefined)).toEqual({
      livePath: "/demo/",
      pinnedPath: null,
    });
  });

  it("previews the Rust access-plane fallback and cache policy", () => {
    expect(
      buildAccessPlanePolicyPreview({
        spaFallback: true,
        cachePolicy: "aggressive",
      }),
    ).toEqual({
      missingAssetBehavior: "index",
      htmlCacheControl: "no-cache",
      assetCacheControl: "public, max-age=31536000, immutable",
      warnings: [
        {
          code: "AGGRESSIVE_CACHE_REQUIRES_IMMUTABLE_ASSETS",
          severity: "warning",
        },
      ],
    });
  });
});
