import { describe, expect, it } from "vitest";
import { hasPendingRelease, shouldPollReleases } from "../src/features/project-detail/releasePolling";

describe("release polling helpers", () => {
  it("detects uploading and processing releases", () => {
    expect(hasPendingRelease([{ status: "ready" }, { status: "processing" }])).toBe(true);
    expect(hasPendingRelease([{ status: "uploading" }])).toBe(true);
    expect(hasPendingRelease([{ status: "ready" }, { status: "failed" }])).toBe(false);
  });

  it("runs the first poll after upload even before the refreshed release appears", () => {
    expect(
      shouldPollReleases({
        enabled: true,
        releases: [{ status: "ready" }],
        attempts: 0,
      }),
    ).toBe(true);
  });

  it("continues while a release is pending and stops once settled or maxed out", () => {
    expect(
      shouldPollReleases({
        enabled: true,
        releases: [{ status: "processing" }],
        attempts: 1,
      }),
    ).toBe(true);
    expect(
      shouldPollReleases({
        enabled: true,
        releases: [{ status: "ready" }],
        attempts: 1,
      }),
    ).toBe(false);
    expect(
      shouldPollReleases({
        enabled: true,
        releases: [{ status: "processing" }],
        attempts: 3,
        maxAttempts: 3,
      }),
    ).toBe(false);
  });
});
