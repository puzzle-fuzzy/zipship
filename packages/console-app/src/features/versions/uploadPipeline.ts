import { getApi, getCsrfHeaders } from "../../api/client";
import { getApiErrorCode } from "../../api/errors";

export type UploadStep =
  | "select"
  | "zipping"
  | "creating_task"
  | "uploading_raw"
  | "processing"
  | "done"
  | "error";

export interface UploadState {
  step: UploadStep;
}

export type UploadFailureReason =
  | "create_failed"
  | "upload_failed"
  | "processing_failed"
  | "unknown";

export class UploadPipelineError extends Error {
  readonly reason: UploadFailureReason;
  readonly detail: string | undefined;

  constructor(reason: UploadFailureReason, detail?: string) {
    super(detail ?? reason);
    this.name = "UploadPipelineError";
    this.reason = reason;
    this.detail = detail;
  }
}

export async function runUploadPipeline(
  projectId: string,
  file: File,
  onState: (state: UploadState) => void,
): Promise<void> {
  const api = getApi();

  onState({ step: "creating_task" });
  const created = await api.POST("/_api/projects/{project_id}/uploads", {
    params: {
      path: { project_id: projectId },
      header: getCsrfHeaders(),
    },
    body: { filename: file.name, sizeBytes: file.size },
  });
  if (created.error || !created.data) {
    throw new UploadPipelineError(
      "create_failed",
      getApiErrorCode(created),
    );
  }

  const uploadId = created.data.upload.id;
  onState({ step: "uploading_raw" });
  const uploaded = await api.PUT("/_api/uploads/{upload_id}/content", {
    params: {
      path: { upload_id: uploadId },
      header: {
        ...getCsrfHeaders(),
        "content-length": file.size,
      },
    },
    headers: { "content-type": "application/zip" },
    body: file as unknown as number[],
    bodySerializer: (body) => body as unknown as BodyInit,
  });
  if (uploaded.error) {
    throw new UploadPipelineError(
      "upload_failed",
      getApiErrorCode(uploaded),
    );
  }

  onState({ step: "processing" });
  const completed = await api.POST("/_api/uploads/{upload_id}/complete", {
    params: {
      path: { upload_id: uploadId },
      header: getCsrfHeaders(),
    },
  });
  if (completed.error || !completed.data) {
    throw new UploadPipelineError(
      "processing_failed",
      getApiErrorCode(completed),
    );
  }

  onState({ step: "done" });
}
