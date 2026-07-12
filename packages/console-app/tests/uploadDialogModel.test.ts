import { describe, expect, it } from "vitest";
import {
  formatUploadSize,
  getUploadProgressPercent,
  getUploadStepState,
} from "../src/features/versions/uploadDialogModel";

describe("upload dialog model", () => {
  it("maps upload steps to progress percentages", () => {
    expect(getUploadProgressPercent("select")).toBe(0);
    expect(getUploadProgressPercent("zipping")).toBe(10);
    expect(getUploadProgressPercent("creating_task")).toBe(30);
    expect(getUploadProgressPercent("uploading_raw")).toBe(60);
    expect(getUploadProgressPercent("processing")).toBe(85);
    expect(getUploadProgressPercent("done")).toBe(100);
    expect(getUploadProgressPercent("error")).toBe(0);
  });

  it("marks completed and current steps in order", () => {
    expect(getUploadStepState("creating_task", "uploading_raw")).toEqual({
      completed: true,
      current: false,
      errored: false,
    });
    expect(getUploadStepState("uploading_raw", "uploading_raw")).toEqual({
      completed: false,
      current: true,
      errored: false,
    });
    expect(getUploadStepState("processing", "uploading_raw")).toEqual({
      completed: false,
      current: false,
      errored: false,
    });
  });

  it("marks the failed step when an upload error happens after progress", () => {
    expect(getUploadStepState("creating_task", "error", "processing")).toEqual({
      completed: true,
      current: false,
      errored: false,
    });
    expect(getUploadStepState("processing", "error", "processing")).toEqual({
      completed: false,
      current: true,
      errored: true,
    });
  });

  it("formats artifact sizes for compact display", () => {
    expect(formatUploadSize(512)).toBe("512 B");
    expect(formatUploadSize(2048)).toBe("2 KB");
    expect(formatUploadSize(2.5 * 1024 * 1024)).toBe("2.5 MB");
  });
});
