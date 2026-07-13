import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "@zipship/api-client";
import { createMockApi, type MockApi } from "./helpers/mockApi";

/**
 * The upload pipeline (create task → raw upload → complete) was extracted from
 * UploadVersionDialog to make it testable. We verify step progression on
 * success and that each failure surface maps to a stable UploadFailureReason.
 */

const { runUploadPipeline, UploadPipelineError } = await import(
  "../src/features/versions/uploadPipeline"
);

let api: MockApi;
let authHeaders: ReturnType<typeof vi.fn<() => { authorization: string }>>;
const file = new File(["data"], "site.zip", { type: "application/zip" });

beforeEach(() => {
  api = createMockApi();
  authHeaders = vi.fn(() => ({ authorization: "Bearer rt-1" }));
});

function upload(onState: (state: { step: string }) => void = () => {}) {
  return runUploadPipeline(
    { api: api as unknown as ApiClient, authHeaders },
    { projectId: "p1", file, onState },
  );
}

describe("runUploadPipeline > success", () => {
  it("walks creating → uploading → processing → done", async () => {
    api.verb("post").mockResolvedValueOnce({ data: { uploadTask: { id: "t1" } } });
    api.verb("put").mockResolvedValueOnce({ data: {} });
    api.verb("post").mockResolvedValueOnce({ data: { uploadTask: { status: "completed" } } });

    const states: string[] = [];
    await upload((s) => states.push(s.step));

    expect(states).toEqual(["creating_task", "uploading_raw", "processing", "done"]);
  });

  it("forwards filename + size when creating the task", async () => {
    api.verb("post").mockResolvedValueOnce({ data: { uploadTask: { id: "t1" } } });
    api.verb("put").mockResolvedValueOnce({ data: {} });
    api.verb("post").mockResolvedValueOnce({ data: { uploadTask: { status: "completed" } } });

    await upload();
    expect(api.verb("post").mock.calls[0][0]).toEqual({
      originalFilename: "site.zip",
      size: file.size,
    });
  });

  it("uses the injected upload dependencies and authorization headers", async () => {
    api.verb("post").mockResolvedValueOnce({ data: { uploadTask: { id: "t1" } } });
    api.verb("put").mockResolvedValueOnce({ data: {} });
    api.verb("post").mockResolvedValueOnce({ data: { uploadTask: { status: "completed" } } });

    await upload();

    expect(authHeaders).toHaveBeenCalledTimes(3);
    expect(api.verb("post").mock.calls[0][1]).toEqual({
      headers: { authorization: "Bearer rt-1" },
    });
    expect(api.verb("put").mock.calls[0][1]).toEqual({
      headers: { authorization: "Bearer rt-1" },
    });
  });
});

describe("runUploadPipeline > failures", () => {
  it("throws create_failed when the task can't be created", async () => {
    api.verb("post").mockResolvedValueOnce({ error: { value: { code: "VALIDATION_ERROR" } } });
    await expect(upload()).rejects.toMatchObject({
      reason: "create_failed",
    });
  });

  it("throws create_failed when the response has no data", async () => {
    api.verb("post").mockResolvedValueOnce({});
    await expect(upload()).rejects.toMatchObject({
      reason: "create_failed",
    });
  });

  it("throws upload_failed when the raw upload errors", async () => {
    api.verb("post").mockResolvedValueOnce({ data: { uploadTask: { id: "t1" } } });
    api.verb("put").mockResolvedValueOnce({ error: { value: { code: "X" } } });
    await expect(upload()).rejects.toMatchObject({
      reason: "upload_failed",
    });
  });

  it("throws processing_failed when complete errors", async () => {
    api.verb("post").mockResolvedValueOnce({ data: { uploadTask: { id: "t1" } } });
    api.verb("put").mockResolvedValueOnce({ data: {} });
    api.verb("post").mockResolvedValueOnce({ error: { value: { code: "X" } } });
    await expect(upload()).rejects.toMatchObject({
      reason: "processing_failed",
    });
  });

  it("throws release_rejected with the server detail when detection fails", async () => {
    api.verb("post").mockResolvedValueOnce({ data: { uploadTask: { id: "t1" } } });
    api.verb("put").mockResolvedValueOnce({ data: {} });
    api.verb("post").mockResolvedValueOnce({
      data: { uploadTask: { status: "failed", errorMessage: "no index.html" } },
    });
    await expect(upload()).rejects.toMatchObject({
      reason: "release_rejected",
      detail: "no index.html",
    });
  });

  it("reports creating_task (but not later steps) before an early failure", async () => {
    api.verb("post").mockResolvedValueOnce({ error: { value: { code: "X" } } });
    const states: string[] = [];
    await expect(upload((s) => states.push(s.step))).rejects.toBeInstanceOf(
      UploadPipelineError,
    );
    expect(states).toEqual(["creating_task"]);
  });
});
