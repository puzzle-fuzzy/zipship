import { describe, expect, it } from "vitest";
import { buildDeploymentReleaseSnapshot } from "../src/features/project-detail/deploymentSnapshot";
import type { Release } from "../src/stores/projectsStore";

function makeRelease(overrides: Partial<Release> = {}): Release {
  return {
    id: "release-1",
    projectId: "project-1",
    versionNumber: 1,
    releaseHash: "abcdef123456",
    previewUrl: null,
    fullHash: "full",
    status: "ready",
    storagePath: "/tmp/site",
    rawUploadPath: "/tmp/upload.zip",
    fileCount: 5,
    totalSize: 1024,
    manifest: {},
    detectResult: {},
    createdBy: "user-1",
    createdAt: "2026-07-09T00:00:00.000Z",
    activatedAt: null,
    archivedAt: null,
    ...overrides,
  };
}

describe("deployment snapshot", () => {
  it("returns unknown snapshot when the release is missing", () => {
    expect(buildDeploymentReleaseSnapshot(undefined)).toEqual({
      qualityLevel: "unknown",
      runtimeLevel: "unknown",
      fileCount: null,
    });
  });

  it("summarizes release quality and artifact size", () => {
    expect(
      buildDeploymentReleaseSnapshot(
        makeRelease({
          detectResult: {
            level: "failed",
            runtime: {
              level: "warning",
              snapshot: { status: 200, consoleMessages: [], failedRequests: [] },
              items: [],
            },
          },
        }),
      ),
    ).toEqual({
      qualityLevel: "failed",
      runtimeLevel: "warning",
      fileCount: 5,
    });
  });
});
