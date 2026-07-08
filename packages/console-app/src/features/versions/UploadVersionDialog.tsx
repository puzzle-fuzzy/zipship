import { CheckCircle2, Circle, FileCode, FileUp, FolderOpen, Loader2, Upload, XCircle } from 'lucide-react';
import { useRef, useState } from 'react';
import JSZip from 'jszip';
import { getApi, authHeaders } from '../../api/client';
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

type UploadMode = 'zip' | 'folder' | 'file';

type UploadStep =
  | 'select'
  | 'zipping'
  | 'creating_task'
  | 'uploading_raw'
  | 'processing'
  | 'done'
  | 'error';

interface UploadState {
  step: UploadStep;
  message: string;
  errorMessage?: string;
}

interface UploadVersionDialogProps {
  open: boolean;
  onClose: () => void;
  projectId: string;
  onUploaded: () => void;
}

/** Execute the full upload pipeline: create task → raw upload → complete. */
async function runUploadPipeline(
  projectId: string,
  file: File,
  onState: (s: UploadState) => void,
) {
  const api = getApi();

  // 1. Create upload task
  onState({ step: 'creating_task', message: '正在创建上传任务...' });
  const createRes = await api._api.projects({ projectId }).uploads.post(
    { originalFilename: file.name, size: file.size },
    { headers: authHeaders() },
  );
  if (createRes.error) throw new Error('创建上传任务失败');
  const uploadTask = createRes.data!.uploadTask;

  // 2. Upload raw bytes
  onState({ step: 'uploading_raw', message: '正在上传文件...' });
  const rawRes = await api._api.uploads({ uploadTaskId: uploadTask.id }).raw.put(
    { file },
    { headers: authHeaders() },
  );
  if (rawRes.error) throw new Error('上传文件失败');

  // 3. Complete & process
  onState({ step: 'processing', message: '正在解压分析...' });
  const completeRes = await api._api.uploads({ uploadTaskId: uploadTask.id }).complete.post(null, {
    headers: authHeaders(),
  });
  if (completeRes.error) throw new Error('处理失败');

  const finalTask = completeRes.data!.uploadTask;

  if (finalTask.status === 'failed') {
    throw new Error(finalTask.errorMessage || '发布检测未通过');
  }

  onState({ step: 'done', message: '上传完成！' });
}

export function UploadVersionDialog({
  open,
  onClose,
  projectId,
  onUploaded,
}: UploadVersionDialogProps) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<UploadMode>('zip');
  const [upload, setUpload] = useState<UploadState>({ step: 'select', message: '' });
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

  async function runAndNotify(file: File) {
    try {
      await runUploadPipeline(projectId, file, setUpload);
      onUploaded();
    } catch (err) {
      setUpload({
        step: 'error',
        message: '上传失败',
        errorMessage: err instanceof Error ? err.message : '未知错误',
      });
    }
  }

  const startUpload = async (file: File) => {
    setUpload({ step: 'zipping', message: file.name.endsWith('.zip') ? '' : '正在打包...' });
    await runAndNotify(file);
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

    setUpload({ step: 'zipping', message: '正在打包文件夹...' });
    try {
      const zip = new JSZip();
      for (const f of fileList) {
        zip.file(f.webkitRelativePath || f.name, await f.arrayBuffer());
      }
      const blob = await zip.generateAsync({ type: 'blob' });
      await runAndNotify(new File([blob], `${folderName}.zip`, { type: 'application/zip' }));
    } catch (err) {
      setUpload({
        step: 'error',
        message: '上传失败',
        errorMessage: err instanceof Error ? err.message : '未知错误',
      });
    }
  };

  const handleSingleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUpload({ step: 'zipping', message: '正在包装文件...' });
    try {
      const zip = new JSZip();
      zip.file(file.name, await file.arrayBuffer());
      const blob = await zip.generateAsync({ type: 'blob' });
      await runAndNotify(new File([blob], 'upload.zip', { type: 'application/zip' }));
    } catch (err) {
      setUpload({
        step: 'error',
        message: '上传失败',
        errorMessage: err instanceof Error ? err.message : '未知错误',
      });
    }
  };

  const handleReset = () => {
    setUpload({ step: 'select', message: '' });
  };

  const handleClose = () => {
    handleReset();
    onClose();
  };

  const stepLabels: Record<UploadStep, string> = {
    zipping: '打包中',
    creating_task: '创建上传任务',
    uploading_raw: '上传文件',
    processing: '解压分析中',
    done: '完成',
    select: '',
    error: '',
  };

  /** If the user is selecting, show the file picker UI */
  if (upload.step === 'select') {
    return (
      <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('versions.uploadTitle')}</DialogTitle>
            <DialogDescription>
              选择 ZIP 文件、文件夹或单个 HTML 文件上传
            </DialogDescription>
          </DialogHeader>

          <Tabs value={mode} onValueChange={(v) => setMode(v as UploadMode)}>
            <TabsList className="w-full">
              <TabsTrigger value="zip" className="flex-1 gap-1.5">
                <FileUp className="size-4" />
                ZIP
              </TabsTrigger>
              <TabsTrigger value="folder" className="flex-1 gap-1.5">
                <FolderOpen className="size-4" />
                文件夹
              </TabsTrigger>
              <TabsTrigger value="file" className="flex-1 gap-1.5">
                <FileCode className="size-4" />
                单个文件
              </TabsTrigger>
            </TabsList>

            <TabsContent value="zip" className="pt-4">
              <div className="flex flex-col items-center gap-4 py-4">
                <div className="flex size-12 items-center justify-center rounded-lg bg-muted">
                  <Upload className="size-6 text-muted-foreground" />
                </div>
                <p className="text-center text-sm text-muted-foreground">
                  选择已构建的 ZIP 文件上传
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
                  选择已构建的 dist 文件夹，自动打包为 ZIP 上传
                </p>
                <Button onClick={() => folderInputRef.current?.click()}>
                  <FolderOpen className="size-4" />
                  选择文件夹
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
                  选择单个 HTML 文件，自动包装为 ZIP 上传
                </p>
                <Button onClick={() => singleFileInputRef.current?.click()}>
                  <FileCode className="size-4" />
                  选择文件
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
          <DialogTitle>
            {upload.step === 'done' ? '上传完成' : upload.step === 'error' ? '上传失败' : '正在上传...'}
          </DialogTitle>
          <DialogDescription>{upload.message}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 py-2">
          {/* Progress bar */}
          <Progress value={progressPercent} className="h-2" />

          {/* Step list */}
          <div className="flex flex-col gap-2">
            {flowSteps.map((step) => {
              const idx = flowSteps.indexOf(step);
              const curIdx = flowSteps.indexOf(upload.step === 'zipping' ? 'creating_task' : upload.step);
              const isCompleted = upload.step === 'done' || idx < curIdx;
              const isCurrent = upload.step === 'done'
                ? false
                : idx === curIdx;
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

          {/* Error detail */}
          {upload.step === 'error' && upload.errorMessage && (
            <div className="mt-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
              {upload.errorMessage}
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
                关闭
              </Button>
              <Button onClick={handleReset}>重试</Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
