export type ReleaseProcessingErrorCode =
  | "RAW_UPLOAD_REQUIRED"
  | "DEPLOY_CORE_FAILED"
  | "DETECT_FAILED"
  | "PROJECT_NOT_FOUND"
  | "RELEASE_NOT_FOUND"
  | "UPLOAD_TASK_NOT_FOUND";

export class ReleaseProcessingError {
  constructor(
    public readonly code: ReleaseProcessingErrorCode,
    public readonly details: Record<string, unknown> = {},
  ) {}
}

export interface ReleaseProcessingSuccess {
  status: "ready";
}

export type ReleaseProcessingResult = ReleaseProcessingSuccess | ReleaseProcessingError;
