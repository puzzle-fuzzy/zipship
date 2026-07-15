import {
  Archive,
  CheckCircle2,
  Circle,
  FileCode,
  FileUp,
  FolderOpen,
  Loader2,
  ShieldCheck,
  Upload,
  XCircle,
} from 'lucide-react';
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
import { Badge } from '../../components/ui/badge';
import { Progress } from '../../components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs';
import { cn } from '../../lib/utils';
import {
  runUploadPipeline,
  UploadPipelineError,
  type UploadFailureReason,
  type UploadStep,
} from './uploadPipeline';
import {
  formatUploadSize,
  getUploadProgressPercent,
  getUploadStepState,
  UPLOAD_FLOW_STEPS,
  type SelectedArtifact,
  type UploadMode,
} from './uploadDialogModel';

interface UploadState {
  step: UploadStep;
  failedStep?: UploadStep;
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
  const [selectedArtifact, setSelectedArtifact] = useState<SelectedArtifact | null>(null);
  const latestUploadStepRef = useRef<UploadStep>('select');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const singleFileInputRef = useRef<HTMLInputElement>(null);

  const progressPercent = getUploadProgressPercent(upload.step);

  const reportUploadState = (state: UploadState) => {
    latestUploadStepRef.current = state.step;
    setUpload(state);
  };

  /** Drive the pipeline, translating any failure into a stable reason. */
  async function runAndNotify(file: File) {
    try {
      await runUploadPipeline(projectId, file, reportUploadState);
      onUploaded();
    } catch (err) {
      const reason = err instanceof UploadPipelineError ? err.reason : 'unknown';
      const detail = err instanceof UploadPipelineError ? err.detail : undefined;
      setUpload({
        step: 'error',
        failedStep: latestUploadStepRef.current,
        failureReason: reason,
        errorDetail: detail,
      });
    }
  }

  const startUpload = (file: File, artifact: SelectedArtifact) => {
    setSelectedArtifact(artifact);
    reportUploadState({ step: 'zipping' });
    void runAndNotify(file);
  };

  const handleZipFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) startUpload(file, { mode: 'zip', name: file.name, size: file.size });
  };

  const handleFolder = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const fileList = Array.from(files);
    const folderName = fileList[0].webkitRelativePath.split('/')[0] || 'upload';
    const totalSize = fileList.reduce((sum, file) => sum + file.size, 0);

    setSelectedArtifact({ mode: 'folder', name: folderName, size: totalSize });
    reportUploadState({ step: 'zipping' });
    try {
      const zip = new JSZip();
      for (const f of fileList) {
        zip.file(f.webkitRelativePath || f.name, await f.arrayBuffer());
      }
      const blob = await zip.generateAsync({ type: 'blob' });
      await runAndNotify(new File([blob], `${folderName}.zip`, { type: 'application/zip' }));
    } catch (err) {
      const reason = err instanceof UploadPipelineError ? err.reason : 'unknown';
      setUpload({ step: 'error', failedStep: latestUploadStepRef.current, failureReason: reason });
    }
  };

  const handleSingleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setSelectedArtifact({ mode: 'file', name: file.name, size: file.size });
    reportUploadState({ step: 'zipping' });
    try {
      const zip = new JSZip();
      zip.file(file.name, await file.arrayBuffer());
      const blob = await zip.generateAsync({ type: 'blob' });
      await runAndNotify(new File([blob], 'upload.zip', { type: 'application/zip' }));
    } catch (err) {
      const reason = err instanceof UploadPipelineError ? err.reason : 'unknown';
      setUpload({ step: 'error', failedStep: latestUploadStepRef.current, failureReason: reason });
    }
  };

  const resetFileInputs = () => {
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (folderInputRef.current) folderInputRef.current.value = '';
    if (singleFileInputRef.current) singleFileInputRef.current.value = '';
  };

  const handleReset = () => {
    resetFileInputs();
    setSelectedArtifact(null);
    reportUploadState({ step: 'select' });
  };
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

  const modeCards: Array<{
    mode: UploadMode;
    icon: typeof FileUp;
    label: string;
    description: string;
    actionLabel: string;
    onSelect: () => void;
    badge?: string;
  }> = [
    {
      mode: 'zip',
      icon: FileUp,
      label: t('upload.zip'),
      description: t('upload.chooseZipDesc'),
      actionLabel: t('versions.chooseFile'),
      onSelect: () => fileInputRef.current?.click(),
      badge: t('upload.recommended'),
    },
    {
      mode: 'folder',
      icon: FolderOpen,
      label: t('upload.folder'),
      description: t('upload.chooseFolderDesc'),
      actionLabel: t('upload.chooseFolder'),
      onSelect: () => folderInputRef.current?.click(),
    },
    {
      mode: 'file',
      icon: FileCode,
      label: t('upload.singleFile'),
      description: t('upload.chooseFileDesc'),
      actionLabel: t('upload.chooseFile'),
      onSelect: () => singleFileInputRef.current?.click(),
    },
  ];

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
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <div className="mb-2 flex size-10 items-center justify-center rounded-lg border bg-primary/10 text-primary">
              <Upload className="size-5" />
            </div>
            <DialogTitle>{t('versions.uploadTitle')}</DialogTitle>
            <DialogDescription>{t('upload.chooseZipFolderFile')}</DialogDescription>
          </DialogHeader>

          <Tabs value={mode} onValueChange={(v) => setMode(v as UploadMode)}>
            <TabsList className="w-full">
              {modeCards.map((card) => (
                <TabsTrigger key={card.mode} value={card.mode} className="flex-1 gap-1.5">
                  <card.icon className="size-4" />
                  {card.label}
                </TabsTrigger>
              ))}
            </TabsList>

            {modeCards.map((card) => (
              <TabsContent key={card.mode} value={card.mode} className="pt-4">
                <button
                  type="button"
                  className="group flex min-h-36 w-full flex-col items-start gap-5 rounded-lg border bg-card/90 p-4 text-left transition-colors hover:border-primary/35 hover:bg-muted/25 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                  onClick={card.onSelect}
                >
                  <div className="flex w-full items-start justify-between gap-4">
                    <div className="flex min-w-0 items-start gap-3">
                      <span className="flex size-11 shrink-0 items-center justify-center rounded-lg border bg-muted text-muted-foreground transition-colors group-hover:text-primary">
                        <card.icon className="size-5" />
                      </span>
                      <span className="min-w-0">
                        <span className="flex flex-wrap items-center gap-2 font-medium">
                          {card.label}
                          {card.badge ? (
                            <Badge variant="secondary" className="rounded-md">
                              {card.badge}
                            </Badge>
                          ) : null}
                        </span>
                        <span className="mt-1 block text-sm text-muted-foreground">
                          {card.description}
                        </span>
                      </span>
                    </div>
                    <span className="shrink-0 rounded-lg border bg-background p-2 text-muted-foreground transition-colors group-hover:text-primary">
                      <Upload className="size-4" />
                    </span>
                  </div>
                  <span className="inline-flex items-center gap-1.5 text-sm font-medium text-primary">
                    {card.actionLabel}
                  </span>
                </button>
              </TabsContent>
            ))}
          </Tabs>

          <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-3">
            <div className="rounded-lg border bg-muted/25 p-2">
              <Archive className="mb-1 size-3.5" />
              {t('upload.hintStatic')}
            </div>
            <div className="rounded-lg border bg-muted/25 p-2">
              <ShieldCheck className="mb-1 size-3.5" />
              {t('upload.hintDetect')}
            </div>
            <div className="rounded-lg border bg-muted/25 p-2">
              <CheckCircle2 className="mb-1 size-3.5" />
              {t('upload.hintPreview')}
            </div>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept=".zip"
            className="hidden"
            onChange={handleZipFile}
          />
          <input
            ref={folderInputRef}
            type="file"
            className="hidden"
            onChange={handleFolder}
            {...{ webkitdirectory: '' }}
          />
          <input
            ref={singleFileInputRef}
            type="file"
            accept=".html,.htm"
            className="hidden"
            onChange={handleSingleFile}
          />
        </DialogContent>
      </Dialog>
    );
  }

  // ─── Progress / status view ───
  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <div
            className={cn(
              'mb-2 flex size-10 items-center justify-center rounded-lg border',
              upload.step === 'done'
                ? 'bg-green-500/10 text-green-600'
                : upload.step === 'error'
                  ? 'bg-destructive/10 text-destructive'
                  : 'bg-primary/10 text-primary',
            )}
          >
            {upload.step === 'done' ? (
              <CheckCircle2 className="size-5" />
            ) : upload.step === 'error' ? (
              <XCircle className="size-5" />
            ) : (
              <Loader2 className="size-5 animate-spin" />
            )}
          </div>
          <DialogTitle>{t(titleKey)}</DialogTitle>
          {descriptionKey[upload.step] && (
            <DialogDescription>{t(descriptionKey[upload.step])}</DialogDescription>
          )}
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2">
          <div className="rounded-lg border bg-muted/25 p-3">
            <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                  {t('upload.progress')}
                </div>
                {selectedArtifact ? (
                  <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                    <span className="truncate font-medium">{selectedArtifact.name}</span>
                    <span className="text-muted-foreground">
                      {t(`upload.modeLabel.${selectedArtifact.mode}`)} / {formatUploadSize(selectedArtifact.size)}
                    </span>
                  </div>
                ) : null}
              </div>
              <span className="text-xs text-muted-foreground">{progressPercent}%</span>
            </div>
            <Progress value={progressPercent} className="h-2" />
          </div>

          <div className="grid gap-2">
            {UPLOAD_FLOW_STEPS.map((step) => {
              const { completed: isCompleted, current: isCurrent, errored: isErrored } = getUploadStepState(
                step,
                upload.step,
                upload.failedStep,
              );

              return (
                <div
                  key={step}
                  className={cn(
                    'flex items-center gap-3 rounded-lg border px-3 py-2 text-sm',
                    isCurrent && 'border-primary/30 bg-primary/5',
                    isErrored && 'border-destructive/30 bg-destructive/10',
                    isCompleted && 'bg-muted/20',
                  )}
                >
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-full border bg-background">
                    {isCompleted ? (
                      <CheckCircle2 className="size-4 text-green-500" />
                    ) : isErrored ? (
                      <XCircle className="size-4 text-destructive" />
                    ) : isCurrent ? (
                      <Loader2 className="size-4 animate-spin text-primary" />
                    ) : (
                      <Circle className="size-4 text-muted-foreground/40" />
                    )}
                  </span>
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
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              <div className="font-medium">
                {upload.failureReason && t(`upload.failure.${upload.failureReason}`)}
              </div>
              {upload.errorDetail && (
                <div className="mt-1 text-xs opacity-80">{upload.errorDetail}</div>
              )}
            </div>
          )}
          {upload.step === 'done' && (
            <div className="rounded-lg border border-green-500/25 bg-green-500/10 p-3 text-sm text-green-700">
              {t('upload.doneNext')}
            </div>
          )}
        </div>

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          {upload.step === 'done' && (
            <Button className="w-full sm:w-auto" onClick={handleClose}>
              {t('common.confirm')}
            </Button>
          )}
          {upload.step === 'error' && (
            <>
              <Button variant="outline" className="w-full sm:w-auto" onClick={handleClose}>
                {t('upload.close')}
              </Button>
              <Button className="w-full sm:w-auto" onClick={handleReset}>
                {t('upload.chooseAnother')}
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
