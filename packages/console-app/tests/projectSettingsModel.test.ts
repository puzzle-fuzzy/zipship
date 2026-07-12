import { describe, expect, it } from "vitest";
import { buildProjectProductionPaths } from "../src/features/project-detail/projectSettingsModel";

describe("project settings model", () => {
  it("builds live and pinned production paths", () => {
    expect(buildProjectProductionPaths("demo", { releaseHash: "abcdef123456" })).toEqual({
      livePath: "/demo/",
      pinnedPath: "/demo/abcdef123456/",
    });
  });

  it("omits the pinned path when no release is active", () => {
    expect(buildProjectProductionPaths("demo", undefined)).toEqual({
      livePath: "/demo/",
      pinnedPath: null,
    });
  });
});
