import type { ApiClient } from '@zipship/api-client';
import type { AuthorizationHeaders } from '../../app/context';

/**
 * Upload pipeline, extracted from UploadVersionDialog so it is independently
 * testable and free of UI/i18n concerns.
 *
 * The dialog reports progress through {@link UploadState} callbacks; failures
 * throw an {@link UploadPipelineError} carrying a stable {@link UploadFailureReason}
 * the UI maps to a translated message (plus any server-provided detail).
 */

export type UploadStep =
  | 'select'
  | 'zipping'
  | 'creating_task'
  | 'uploading_raw'
  | 'processing'
  | 'done'
  | 'error';

export interface UploadState {
  step: UploadStep;
}

export type UploadFailureReason =
  | 'create_failed'
  | 'upload_failed'
  | 'processing_failed'
  | 'release_rejected'
  | 'unknown';

export class UploadPipelineError extends Error {
  readonly reason: UploadFailureReason;
  /** Server-provided detail (e.g. why release detection failed), if any. */
  readonly detail: string | undefined;

  constructor(reason: UploadFailureReason, detail?: string) {
    super(detail ?? reason);
    this.name = 'UploadPipelineError';
    this.reason = reason;
    this.detail = detail;
  }
}

export interface UploadPipelineDependencies {
  api: ApiClient;
  authHeaders: () => AuthorizationHeaders;
}

export interface RunUploadPipelineInput {
  projectId: string;
  file: File;
  onState: (state: UploadState) => void;
}

/**
 * Execute the full upload pipeline: create task → raw upload → complete.
 * Reports progress via `onState` and resolves once the release is `ready`.
 * Throws {@link UploadPipelineError} on any failure.
 */
export async function runUploadPipeline(
  dependencies: UploadPipelineDependencies,
  input: RunUploadPipelineInput,
): Promise<void> {
  const { api, authHeaders } = dependencies;
  const { projectId, file, onState } = input;

  // 1. Create upload task
  onState({ step: 'creating_task' });
  const createRes = await api._api.projects({ projectId }).uploads.post(
    { originalFilename: file.name, size: file.size },
    { headers: authHeaders() },
  );
  if (createRes.error || !createRes.data) throw new UploadPipelineError('create_failed');
  const uploadTask = createRes.data.uploadTask;

  // 2. Upload raw bytes
  onState({ step: 'uploading_raw' });
  const rawRes = await api._api.uploads({ uploadTaskId: uploadTask.id }).raw.put(
    { file },
    { headers: authHeaders() },
  );
  if (rawRes.error) throw new UploadPipelineError('upload_failed');

  // 3. Complete & process
  onState({ step: 'processing' });
  const completeRes = await api._api.uploads({ uploadTaskId: uploadTask.id }).complete.post(null, {
    headers: authHeaders(),
  });
  if (completeRes.error || !completeRes.data) throw new UploadPipelineError('processing_failed');

  const finalTask = completeRes.data.uploadTask;
  if (finalTask.status === 'failed') {
    throw new UploadPipelineError('release_rejected', finalTask.errorMessage ?? undefined);
  }

  onState({ step: 'done' });
}
