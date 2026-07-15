import { useRef, useState } from 'react';
import { UploadArtifactPicker } from './UploadArtifactPicker';
import { UploadProgressDialog } from './UploadProgressDialog';
import {
  describeFolderUpload,
  describeSingleFileUpload,
  prepareFolderUpload,
  prepareSingleFileUpload,
  prepareZipUpload,
  type PreparedUpload,
} from './uploadArchive';
import type { SelectedArtifact, UploadViewState } from './uploadDialogModel';
import {
  runUploadPipeline,
  UploadPipelineError,
  type UploadStep,
} from './uploadPipeline';

interface UploadVersionDialogProps {
  open: boolean;
  onClose: () => void;
  projectId: string;
  onUploaded: () => void;
}

export function UploadVersionDialog({
  open,
  onClose,
  projectId,
  onUploaded,
}: UploadVersionDialogProps) {
  const [upload, setUpload] = useState<UploadViewState>({ step: 'select' });
  const [selectedArtifact, setSelectedArtifact] = useState<SelectedArtifact | null>(null);
  const latestUploadStepRef = useRef<UploadStep>('select');

  const reportUploadState = (state: UploadViewState) => {
    latestUploadStepRef.current = state.step;
    setUpload(state);
  };

  const failUpload = (error: unknown) => {
    setUpload({
      step: 'error',
      failedStep: latestUploadStepRef.current,
      failureReason: error instanceof UploadPipelineError ? error.reason : 'unknown',
      errorDetail: error instanceof UploadPipelineError ? error.detail : undefined,
    });
  };

  const runAndNotify = async (file: File) => {
    try {
      await runUploadPipeline(projectId, file, reportUploadState);
      onUploaded();
    } catch (error) {
      failUpload(error);
    }
  };

  const startPreparedUpload = ({ artifact, archive }: PreparedUpload) => {
    setSelectedArtifact(artifact);
    reportUploadState({ step: 'zipping' });
    void runAndNotify(archive);
  };

  const prepareAndStartUpload = async (
    artifact: SelectedArtifact,
    prepare: () => Promise<PreparedUpload>,
  ) => {
    setSelectedArtifact(artifact);
    reportUploadState({ step: 'zipping' });
    try {
      const prepared = await prepare();
      await runAndNotify(prepared.archive);
    } catch (error) {
      failUpload(error);
    }
  };

  const handleReset = () => {
    setSelectedArtifact(null);
    reportUploadState({ step: 'select' });
  };

  const handleClose = () => {
    handleReset();
    onClose();
  };

  if (upload.step === 'select') {
    return (
      <UploadArtifactPicker
        open={open}
        onClose={handleClose}
        onZipSelected={(file) => startPreparedUpload(prepareZipUpload(file))}
        onFolderSelected={(files) =>
          void prepareAndStartUpload(describeFolderUpload(files), () => prepareFolderUpload(files))
        }
        onSingleFileSelected={(file) =>
          void prepareAndStartUpload(describeSingleFileUpload(file), () =>
            prepareSingleFileUpload(file),
          )
        }
      />
    );
  }

  return (
    <UploadProgressDialog
      open={open}
      selectedArtifact={selectedArtifact}
      upload={upload}
      onClose={handleClose}
      onReset={handleReset}
    />
  );
}
