import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockApi, type MockApi } from "./helpers/mockApi";
import { setAccessToken } from "../src/api/client";

/**
 * The upload pipeline (create task → raw upload → complete) was extracted from
 * UploadVersionDialog to make it testable. We verify step progression on
 * success and that each failure surface maps to a stable UploadFailureReason.
 */

const { mockApi, setMockApi } = vi.hoisted(() => {
  let current: unknown = null;
  return {
    mockApi: () => current,
    setMockApi: (a: unknown) => {
      current = a;
    },
  };
});

vi.mock("../src/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/api/client")>();
  return { ...actual, getApi: () => mockApi() };
});

const { runUploadPipeline, UploadPipelineError } = await import(
  "../src/features/versions/uploadPipeline"
);

let api: MockApi;
const file = new File(["data"], "site.zip", { type: "application/zip" });

beforeEach(() => {
  api = createMockApi();
  setMockApi(api._api);
  setAccessToken("rt-1");
});

describe("runUploadPipeline > success", () => {
  it("walks creating → uploading → processing → done", async () => {
    api.verb("post").mockResolvedValueOnce({ data: { uploadTask: { id: "t1" } } });
    api.verb("put").mockResolvedValueOnce({ data: {} });
    api.verb("post").mockResolvedValueOnce({ data: { uploadTask: { status: "ready" } } });

    const states: string[] = [];
    await runUploadPipeline("p1", file, (s) => states.push(s.step));

    expect(states).toEqual(["creating_task", "uploading_raw", "processing", "done"]);
  });

  it("forwards filename + size when creating the task", async () => {
    api.verb("post").mockResolvedValueOnce({ data: { uploadTask: { id: "t1" } } });
    api.verb("put").mockResolvedValueOnce({ data: {} });
    api.verb("post").mockResolvedValueOnce({ data: { uploadTask: { status: "ready" } } });

    await runUploadPipeline("p1", file, () => {});
    expect(api.verb("post").mock.calls[0][0]).toEqual({
      originalFilename: "site.zip",
      size: file.size,
    });
  });
});

describe("runUploadPipeline > failures", () => {
  it("throws create_failed when the task can't be created", async () => {
    api.verb("post").mockResolvedValueOnce({ error: { value: { code: "VALIDATION_ERROR" } } });
    await expect(runUploadPipeline("p1", file, () => {})).rejects.toMatchObject({
      reason: "create_failed",
    });
  });

  it("throws create_failed when the response has no data", async () => {
    api.verb("post").mockResolvedValueOnce({});
    await expect(runUploadPipeline("p1", file, () => {})).rejects.toMatchObject({
      reason: "create_failed",
    });
  });

  it("throws upload_failed when the raw upload errors", async () => {
    api.verb("post").mockResolvedValueOnce({ data: { uploadTask: { id: "t1" } } });
    api.verb("put").mockResolvedValueOnce({ error: { value: { code: "X" } } });
    await expect(runUploadPipeline("p1", file, () => {})).rejects.toMatchObject({
      reason: "upload_failed",
    });
  });

  it("throws processing_failed when complete errors", async () => {
    api.verb("post").mockResolvedValueOnce({ data: { uploadTask: { id: "t1" } } });
    api.verb("put").mockResolvedValueOnce({ data: {} });
    api.verb("post").mockResolvedValueOnce({ error: { value: { code: "X" } } });
    await expect(runUploadPipeline("p1", file, () => {})).rejects.toMatchObject({
      reason: "processing_failed",
    });
  });

  it("throws release_rejected with the server detail when detection fails", async () => {
    api.verb("post").mockResolvedValueOnce({ data: { uploadTask: { id: "t1" } } });
    api.verb("put").mockResolvedValueOnce({ data: {} });
    api.verb("post").mockResolvedValueOnce({
      data: { uploadTask: { status: "failed", errorMessage: "no index.html" } },
    });
    await expect(runUploadPipeline("p1", file, () => {})).rejects.toMatchObject({
      reason: "release_rejected",
      detail: "no index.html",
    });
  });

  it("reports creating_task (but not later steps) before an early failure", async () => {
    api.verb("post").mockResolvedValueOnce({ error: { value: { code: "X" } } });
    const states: string[] = [];
    await expect(runUploadPipeline("p1", file, (s) => states.push(s.step))).rejects.toBeInstanceOf(
      UploadPipelineError,
    );
    expect(states).toEqual(["creating_task"]);
  });
});
