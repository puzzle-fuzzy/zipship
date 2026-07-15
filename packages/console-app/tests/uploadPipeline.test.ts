import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockApi, type MockApi } from './helpers/mockApi';

const { mockApi, setMockApi } = vi.hoisted(() => {
  let current: unknown;
  return { mockApi: () => current, setMockApi: (api: unknown) => { current = api; } };
});

vi.mock('../src/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/api/client')>();
  return { ...actual, getApi: () => mockApi() };
});

const { runUploadPipeline, UploadPipelineError } = await import('../src/features/versions/uploadPipeline');
let api: MockApi;
const file = new File(['data'], 'site.zip', { type: 'application/zip' });

beforeEach(() => {
  api = createMockApi();
  setMockApi(api._api);
  document.cookie = 'zipship_csrf=test-csrf; Path=/';
});

describe('Rust upload pipeline', () => {
  it('walks create, raw content, finalize, and done', async () => {
    api.verb('post')
      .mockResolvedValueOnce({ data: { upload: { id: 'upload-1' } } })
      .mockResolvedValueOnce({ data: { upload: { id: 'upload-1' }, releaseId: 'r1', jobId: 'j1' } });
    api.verb('put').mockResolvedValueOnce({});
    const steps: string[] = [];

    await runUploadPipeline('p1', file, ({ step }) => steps.push(step));

    expect(steps).toEqual(['creating_task', 'uploading_raw', 'processing', 'done']);
    expect(api.verb('post').mock.calls[0]).toEqual([
      '/_api/projects/{project_id}/uploads',
      {
        params: {
          path: { project_id: 'p1' },
          header: { 'x-csrf-token': 'test-csrf' },
        },
        body: { filename: 'site.zip', sizeBytes: file.size },
      },
    ]);
    expect(api.verb('put').mock.calls[0][0]).toBe('/_api/uploads/{upload_id}/content');
    expect(api.verb('put').mock.calls[0][1]).toMatchObject({
      params: {
        path: { upload_id: 'upload-1' },
        header: { 'x-csrf-token': 'test-csrf', 'content-length': file.size },
      },
      headers: { 'content-type': 'application/zip' },
      body: file,
    });
    expect(api.verb('post').mock.calls[1]).toEqual([
      '/_api/uploads/{upload_id}/complete',
      {
        params: {
          path: { upload_id: 'upload-1' },
          header: { 'x-csrf-token': 'test-csrf' },
        },
      },
    ]);
  });

  it('stops with create_failed and retains the API code', async () => {
    api.verb('post').mockResolvedValueOnce({ error: { code: 'INVALID_UPLOAD_FILENAME' } });
    await expect(runUploadPipeline('p1', file, () => {})).rejects.toMatchObject({
      reason: 'create_failed',
      detail: 'INVALID_UPLOAD_FILENAME',
    });
    expect(api.verb('put')).not.toHaveBeenCalled();
  });

  it('stops with upload_failed before finalization', async () => {
    api.verb('post').mockResolvedValueOnce({ data: { upload: { id: 'upload-1' } } });
    api.verb('put').mockResolvedValueOnce({ error: { code: 'UPLOAD_SIZE_MISMATCH' } });
    await expect(runUploadPipeline('p1', file, () => {})).rejects.toMatchObject({
      reason: 'upload_failed',
      detail: 'UPLOAD_SIZE_MISMATCH',
    });
    expect(api.verb('post')).toHaveBeenCalledTimes(1);
  });

  it('maps finalization failures without reporting done', async () => {
    api.verb('post')
      .mockResolvedValueOnce({ data: { upload: { id: 'upload-1' } } })
      .mockResolvedValueOnce({ error: { code: 'UPLOAD_NOT_READY' } });
    api.verb('put').mockResolvedValueOnce({});
    const steps: string[] = [];
    await expect(runUploadPipeline('p1', file, ({ step }) => steps.push(step))).rejects.toMatchObject({
      reason: 'processing_failed',
      detail: 'UPLOAD_NOT_READY',
    });
    expect(steps).toEqual(['creating_task', 'uploading_raw', 'processing']);
  });

  it('uses a typed pipeline error for stable UI handling', async () => {
    api.verb('post').mockResolvedValueOnce({});
    await expect(runUploadPipeline('p1', file, () => {})).rejects.toBeInstanceOf(UploadPipelineError);
  });
});
