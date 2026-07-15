import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSettingsStore } from '../src/stores/settingsStore';
import type { runUploadPipeline as RunUploadPipeline } from '../src/features/versions/uploadPipeline';

const pipeline = vi.hoisted(() => ({
  run: vi.fn<typeof RunUploadPipeline>(),
}));

vi.mock('../src/features/versions/uploadPipeline', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('../src/features/versions/uploadPipeline')
  >();
  return { ...actual, runUploadPipeline: pipeline.run };
});

const { UploadVersionDialog } = await import(
  '../src/features/versions/UploadVersionDialog'
);
const { UploadPipelineError } = await import(
  '../src/features/versions/uploadPipeline'
);

beforeEach(() => {
  useSettingsStore.setState({ language: 'en' });
  pipeline.run.mockReset();
  global.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

describe('UploadVersionDialog', () => {
  it('moves a selected zip through the upload pipeline', async () => {
    pipeline.run.mockImplementationOnce(async (_projectId, _file, onState) => {
      onState({ step: 'creating_task' });
      onState({ step: 'uploading_raw' });
      onState({ step: 'processing' });
      onState({ step: 'done' });
    });
    const onUploaded = vi.fn();
    render(
      <UploadVersionDialog
        open
        projectId="project-1"
        onClose={vi.fn()}
        onUploaded={onUploaded}
      />,
    );
    const file = new File(['archive'], 'site.zip', { type: 'application/zip' });
    const input = document.querySelector<HTMLInputElement>('input[accept=".zip"]');

    expect(screen.getByRole('dialog', { name: 'Upload Version' })).toBeInTheDocument();
    expect(input).not.toBeNull();
    fireEvent.change(input!, { target: { files: [file] } });

    await waitFor(() => expect(pipeline.run).toHaveBeenCalledWith('project-1', file, expect.any(Function)));
    expect(await screen.findByRole('dialog', { name: 'Upload complete' })).toBeInTheDocument();
    expect(onUploaded).toHaveBeenCalledOnce();
  });

  it('shows pipeline failure details and can return to artifact selection', async () => {
    pipeline.run.mockImplementationOnce(async (_projectId, _file, onState) => {
      onState({ step: 'processing' });
      throw new UploadPipelineError('processing_failed', 'DETECTION_FAILED');
    });
    const user = userEvent.setup();
    render(
      <UploadVersionDialog
        open
        projectId="project-1"
        onClose={vi.fn()}
        onUploaded={vi.fn()}
      />,
    );
    const file = new File(['archive'], 'site.zip', { type: 'application/zip' });
    const input = document.querySelector<HTMLInputElement>('input[accept=".zip"]');

    fireEvent.change(input!, { target: { files: [file] } });

    expect(await screen.findByRole('dialog', { name: 'Upload failed' })).toBeInTheDocument();
    expect(screen.getByText('DETECTION_FAILED')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Choose another artifact' }));
    expect(screen.getByRole('dialog', { name: 'Upload Version' })).toBeInTheDocument();
  });
});
