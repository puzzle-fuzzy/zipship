import { CheckCircle2, Circle, FileCode, FileUp, FolderOpen, Loader2, Upload, XCircle } from 'lucide-react';
import { useRef, useState } from 'react';
import JSZip from 'jszip';
import { useTranslation } from '../../i18n';
import { Button } from '../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { Progress } from '../../components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs';
import {
  runUploadPipeline,
  UploadPipelineError,
  type UploadFailureReason,
  type UploadStep,
} from './uploadPipeline';

type UploadMode = 'zip' | 'folder' | 'file';

interface UploadState {
  step: UploadStep;
  /** Stable reason when step === 'error'; the UI maps it to a message. */
  failureReason?: UploadFailureReason;
  /** Server-provided detail (e.g. why release detection failed). */
  errorDetail?: string;
}

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
  const { t } = useTranslation();
  const [mode, setMode] = useState<UploadMode>('zip');
  const [upload, setUpload] = useState<UploadState>({ step: 'select' });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const singleFileInputRef = useRef<HTMLInputElement>(null);

  const progressPercent =
    upload.step === 'zipping' ? 10 :
    upload.step === 'creating_task' ? 30 :
    upload.step === 'uploading_raw' ? 60 :
    upload.step === 'processing' ? 85 :
    upload.step === 'done' ? 100 :
    0;

  /** Drive the pipeline, translating any failure into a stable reason. */
  async function runAndNotify(file: File) {
    try {
      await runUploadPipeline(projectId, file, setUpload);
      onUploaded();
    } catch (err) {
      const reason = err instanceof UploadPipelineError ? err.reason : 'unknown';
      const detail = err instanceof UploadPipelineError ? err.detail : undefined;
      setUpload({ step: 'error', failureReason: reason, errorDetail: detail });
    }
  }

  const startUpload = (file: File) => {
    setUpload({ step: 'zipping' });
    void runAndNotify(file);
  };

  const handleZipFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) startUpload(file);
  };

  const handleFolder = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const fileList = Array.from(files);
    const folderName = fileList[0].webkitRelativePath.split('/')[0] || 'upload';

    setUpload({ step: 'zipping' });
    try {
      const zip = new JSZip();
      for (const f of fileList) {
        zip.file(f.webkitRelativePath || f.name, await f.arrayBuffer());
      }
      const blob = await zip.generateAsync({ type: 'blob' });
      await runAndNotify(new File([blob], `${folderName}.zip`, { type: 'application/zip' }));
    } catch (err) {
      const reason = err instanceof UploadPipelineError ? err.reason : 'unknown';
      setUpload({ step: 'error', failureReason: reason });
    }
  };

  const handleSingleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUpload({ step: 'zipping' });
    try {
      const zip = new JSZip();
      zip.file(file.name, await file.arrayBuffer());
      const blob = await zip.generateAsync({ type: 'blob' });
      await runAndNotify(new File([blob], 'upload.zip', { type: 'application/zip' }));
    } catch (err) {
      const reason = err instanceof UploadPipelineError ? err.reason : 'unknown';
      setUpload({ step: 'error', failureReason: reason });
    }
  };

  const handleReset = () => setUpload({ step: 'select' });
  const handleClose = () => {
    handleReset();
    onClose();
  };

  const stepLabels: Record<UploadStep, string> = {
    zipping: t('upload.stepZipping'),
    creating_task: t('upload.stepCreatingTask'),
    uploading_raw: t('upload.stepUploading'),
    processing: t('upload.stepProcessing'),
    done: t('upload.stepDone'),
    select: '',
    error: '',
  };

  const titleKey =
    upload.step === 'done' ? 'upload.statusDone'
    : upload.step === 'error' ? 'upload.statusFailed'
    : 'upload.statusUploading';

  const descriptionKey: Record<UploadStep, string> = {
    zipping: 'upload.desc.zipping',
    creating_task: 'upload.desc.creatingTask',
    uploading_raw: 'upload.desc.uploading',
    processing: 'upload.desc.processing',
    done: 'upload.desc.done',
    select: '',
    error: '',
  };

  /** ─── File-picker view ─── */
  if (upload.step === 'select') {
    return (
      <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('versions.uploadTitle')}</DialogTitle>
            <DialogDescription>{t('upload.chooseZipFolderFile')}</DialogDescription>
          </DialogHeader>

          <Tabs value={mode} onValueChange={(v) => setMode(v as UploadMode)}>
            <TabsList className="w-full">
              <TabsTrigger value="zip" className="flex-1 gap-1.5">
                <FileUp className="size-4" />
                {t('upload.zip')}
              </TabsTrigger>
              <TabsTrigger value="folder" className="flex-1 gap-1.5">
                <FolderOpen className="size-4" />
                {t('upload.folder')}
              </TabsTrigger>
              <TabsTrigger value="file" className="flex-1 gap-1.5">
                <FileCode className="size-4" />
                {t('upload.singleFile')}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="zip" className="pt-4">
              <div className="flex flex-col items-center gap-4 py-4">
                <div className="flex size-12 items-center justify-center rounded-lg bg-muted">
                  <Upload className="size-6 text-muted-foreground" />
                </div>
                <p className="text-center text-sm text-muted-foreground">
                  {t('upload.chooseZipDesc')}
                </p>
                <Button onClick={() => fileInputRef.current?.click()}>
                  <Upload className="size-4" />
                  {t('versions.chooseFile')}
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".zip"
                  className="hidden"
                  onChange={handleZipFile}
                />
              </div>
            </TabsContent>

            <TabsContent value="folder" className="pt-4">
              <div className="flex flex-col items-center gap-4 py-4">
                <div className="flex size-12 items-center justify-center rounded-lg bg-muted">
                  <FolderOpen className="size-6 text-muted-foreground" />
                </div>
                <p className="text-center text-sm text-muted-foreground">
                  {t('upload.chooseFolderDesc')}
                </p>
                <Button onClick={() => folderInputRef.current?.click()}>
                  <FolderOpen className="size-4" />
                  {t('upload.chooseFolder')}
                </Button>
                <input
                  ref={folderInputRef}
                  type="file"
                  className="hidden"
                  onChange={handleFolder}
                  {...{ webkitdirectory: '' }}
                />
              </div>
            </TabsContent>

            <TabsContent value="file" className="pt-4">
              <div className="flex flex-col items-center gap-4 py-4">
                <div className="flex size-12 items-center justify-center rounded-lg bg-muted">
                  <FileCode className="size-6 text-muted-foreground" />
                </div>
                <p className="text-center text-sm text-muted-foreground">
                  {t('upload.chooseFileDesc')}
                </p>
                <Button onClick={() => singleFileInputRef.current?.click()}>
                  <FileCode className="size-4" />
                  {t('upload.chooseFile')}
                </Button>
                <input
                  ref={singleFileInputRef}
                  type="file"
                  accept=".html,.htm"
                  className="hidden"
                  onChange={handleSingleFile}
                />
              </div>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>
    );
  }

  // ─── Progress / status view ───
  const flowSteps: UploadStep[] = ['creating_task', 'uploading_raw', 'processing', 'done'];

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t(titleKey)}</DialogTitle>
          {descriptionKey[upload.step] && (
            <DialogDescription>{t(descriptionKey[upload.step])}</DialogDescription>
          )}
        </DialogHeader>

        <div className="flex flex-col gap-3 py-2">
          <Progress value={progressPercent} className="h-2" />

          <div className="flex flex-col gap-2">
            {flowSteps.map((step) => {
              const idx = flowSteps.indexOf(step);
              const curIdx = flowSteps.indexOf(upload.step === 'zipping' ? 'creating_task' : upload.step);
              const isCompleted = upload.step === 'done' || idx < curIdx;
              const isCurrent = upload.step === 'done' ? false : idx === curIdx;
              const isErrored = upload.step === 'error' && !isCompleted && idx === (curIdx >= 0 ? curIdx : 0);

              return (
                <div key={step} className="flex items-center gap-3 text-sm">
                  {isCompleted ? (
                    <CheckCircle2 className="size-4 text-green-500" />
                  ) : isErrored ? (
                    <XCircle className="size-4 text-destructive" />
                  ) : isCurrent ? (
                    <Loader2 className="size-4 animate-spin text-primary" />
                  ) : (
                    <Circle className="size-4 text-muted-foreground/40" />
                  )}
                  <span
                    className={
                      isErrored
                        ? 'text-destructive'
                        : isCurrent
                          ? 'font-medium text-foreground'
                          : isCompleted
                            ? 'text-muted-foreground'
                            : 'text-muted-foreground/50'
                    }
                  >
                    {stepLabels[step]}
                  </span>
                </div>
              );
            })}
          </div>

          {upload.step === 'error' && (
            <div className="mt-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
              {upload.failureReason && t(`upload.failure.${upload.failureReason}`)}
              {upload.errorDetail && (
                <span className="mt-1 block opacity-80">{upload.errorDetail}</span>
              )}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2">
          {upload.step === 'done' && (
            <Button onClick={handleClose}>{t('common.confirm')}</Button>
          )}
          {upload.step === 'error' && (
            <>
              <Button variant="outline" onClick={handleClose}>
                {t('upload.close')}
              </Button>
              <Button onClick={handleReset}>{t('upload.retry')}</Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
