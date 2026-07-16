import { CheckCircle2, Circle, Loader2, XCircle } from 'lucide-react';
import { Button } from '../../components/primitives/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../components/primitives/dialog';
import { Progress } from '../../components/primitives/progress';
import { useTranslation } from '../../i18n';
import { cn } from '../../lib/utils';
import {
  formatUploadSize,
  getUploadProgressPercent,
  getUploadStepState,
  UPLOAD_FLOW_STEPS,
  type SelectedArtifact,
  type UploadViewState,
} from './uploadDialogModel';
import type { UploadStep } from './uploadPipeline';

interface UploadProgressDialogProps {
  open: boolean;
  selectedArtifact: SelectedArtifact | null;
  upload: UploadViewState;
  onClose: () => void;
  onReset: () => void;
}

export function UploadProgressDialog({
  open,
  selectedArtifact,
  upload,
  onClose,
  onReset,
}: UploadProgressDialogProps) {
  const { t } = useTranslation();
  const progressPercent = getUploadProgressPercent(upload.step);
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
    upload.step === 'done'
      ? 'upload.statusDone'
      : upload.step === 'error'
        ? 'upload.statusFailed'
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

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <div
            className={cn(
              'mb-2 flex size-10 items-center justify-center rounded-lg border',
              upload.step === 'done'
                ? 'bg-primary/10 text-primary'
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
          {descriptionKey[upload.step] ? (
            <DialogDescription>{t(descriptionKey[upload.step])}</DialogDescription>
          ) : null}
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
                      {t(`upload.modeLabel.${selectedArtifact.mode}`)} /{' '}
                      {formatUploadSize(selectedArtifact.size)}
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
              const { completed, current, errored } = getUploadStepState(
                step,
                upload.step,
                upload.failedStep,
              );

              return (
                <div
                  key={step}
                  className={cn(
                    'flex items-center gap-3 rounded-lg border px-3 py-2 text-sm',
                    current && 'border-primary/30 bg-primary/5',
                    errored && 'border-destructive/30 bg-destructive/10',
                    completed && 'bg-muted/20',
                  )}
                >
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-full border bg-background">
                    {completed ? (
                      <CheckCircle2 className="size-4 text-primary" />
                    ) : errored ? (
                      <XCircle className="size-4 text-destructive" />
                    ) : current ? (
                      <Loader2 className="size-4 animate-spin text-primary" />
                    ) : (
                      <Circle className="size-4 text-muted-foreground/40" />
                    )}
                  </span>
                  <span
                    className={
                      errored
                        ? 'text-destructive'
                        : current
                          ? 'font-medium text-foreground'
                          : completed
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

          {upload.step === 'error' ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              <div className="font-medium">
                {upload.failureReason ? t(`upload.failure.${upload.failureReason}`) : null}
              </div>
              {upload.errorDetail ? (
                <div className="mt-1 text-xs opacity-80">{upload.errorDetail}</div>
              ) : null}
            </div>
          ) : null}
          {upload.step === 'done' ? (
            <div className="rounded-lg border border-primary/25 bg-primary/10 p-3 text-sm text-primary">
              {t('upload.doneNext')}
            </div>
          ) : null}
        </div>

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          {upload.step === 'done' ? (
            <Button className="w-full sm:w-auto" onClick={onClose}>
              {t('common.confirm')}
            </Button>
          ) : null}
          {upload.step === 'error' ? (
            <>
              <Button variant="outline" className="w-full sm:w-auto" onClick={onClose}>
                {t('upload.close')}
              </Button>
              <Button className="w-full sm:w-auto" onClick={onReset}>
                {t('upload.chooseAnother')}
              </Button>
            </>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
