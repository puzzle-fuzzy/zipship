import { describe, expect, it } from "vitest";
import { findUploadedReleaseHighlight } from "../src/features/project-detail/uploadResultHighlight";

describe("upload result highlight", () => {
  it("returns the new latest release id after upload", () => {
    expect(
      findUploadedReleaseHighlight([{ id: "release-2" }, { id: "release-1" }], "release-1"),
    ).toBe("release-2");
  });

  it("waits while the latest release has not changed", () => {
    expect(findUploadedReleaseHighlight([{ id: "release-1" }], "release-1")).toBeNull();
  });

  it("waits until a first release appears", () => {
    expect(findUploadedReleaseHighlight([], null)).toBeNull();
    expect(findUploadedReleaseHighlight([{ id: "release-1" }], null)).toBe("release-1");
  });
});
