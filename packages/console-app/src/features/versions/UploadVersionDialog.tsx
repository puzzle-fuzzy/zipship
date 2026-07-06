import { FileCode, FileUp, FolderOpen, Loader2, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import JSZip from 'jszip';
import { createApiClient } from '@zipship/api-client';
import { useTranslation } from '../../i18n';
import { Button } from '../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs';

type UploadMode = 'zip' | 'folder' | 'file';

interface UploadVersionDialogProps {
  open: boolean;
  onClose: () => void;
  projectId: string;
  refreshToken: string;
  apiBaseUrl: string;
  onUploaded: () => void;
}

export function UploadVersionDialog({
  open,
  onClose,
  projectId,
  refreshToken,
  apiBaseUrl,
  onUploaded,
}: UploadVersionDialogProps) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<UploadMode>('zip');
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const singleFileInputRef = useRef<HTMLInputElement>(null);

  const uploadFile = async (file: File) => {
    setUploading(true);
    try {
      const api = createApiClient(apiBaseUrl);
      const res = await api._api.projects({ projectId }).uploads.post(
        { originalFilename: file.name, size: file.size },
        { headers: { authorization: `Bearer ${refreshToken}` } },
      );
      if (res.error) throw new Error('Failed to create upload task');
      const uploadTask = res.data!.uploadTask;
      toast.success('Upload task created');
      onClose();
      onUploaded();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const uploadZipFromFiles = async (files: File[], archiveName: string) => {
    setUploading(true);
    try {
      const zip = new JSZip();
      for (const file of files) {
        const bytes = await file.arrayBuffer();
        // Preserve folder structure relative to root
        zip.file(file.webkitRelativePath || file.name, bytes);
      }
      const blob = await zip.generateAsync({ type: 'blob' });
      const archiveFile = new File([blob], archiveName, { type: 'application/zip' });

      const api = createApiClient(apiBaseUrl);
      const res = await api._api.projects({ projectId }).uploads.post(
        { originalFilename: archiveFile.name, size: archiveFile.size },
        { headers: { authorization: `Bearer ${refreshToken}` } },
      );
      if (res.error) throw new Error('Failed to create upload task');
      toast.success('Upload task created');

      // TODO: upload raw bytes via PUT /raw after getting pre-signed URL or direct write
      onClose();
      onUploaded();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleZipFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) uploadFile(file);
  };

  const handleFolder = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const fileList = Array.from(files);
    const folderName = fileList[0].webkitRelativePath.split('/')[0] || 'upload';
    uploadZipFromFiles(fileList, `${folderName}.zip`);
  };

  const handleSingleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Wrap single file in a ZIP with index.html (or use the file as-is)
    uploadZipFromFiles([file], 'upload.zip');
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
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
              <p className="text-sm text-muted-foreground text-center">
                选择已构建的 ZIP 文件上传
              </p>
              <Button onClick={() => fileInputRef.current?.click()} disabled={uploading}>
                {uploading ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
                {uploading ? t('versions.uploading') : t('versions.chooseFile')}
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
              <p className="text-sm text-muted-foreground text-center">
                选择已构建的 dist 文件夹，自动打包为 ZIP 上传
              </p>
              <Button onClick={() => folderInputRef.current?.click()} disabled={uploading}>
                {uploading ? <Loader2 className="size-4 animate-spin" /> : <FolderOpen className="size-4" />}
                {uploading ? '打包中...' : '选择文件夹'}
              </Button>
              <input
                ref={folderInputRef}
                type="file"
                className="hidden"
                onChange={handleFolder}
                {...{ webkitdirectory: "" }}
              />
            </div>
          </TabsContent>

          <TabsContent value="file" className="pt-4">
            <div className="flex flex-col items-center gap-4 py-4">
              <div className="flex size-12 items-center justify-center rounded-lg bg-muted">
                <FileCode className="size-6 text-muted-foreground" />
              </div>
              <p className="text-sm text-muted-foreground text-center">
                选择单个 HTML 文件，自动包装为 ZIP 上传
              </p>
              <Button onClick={() => singleFileInputRef.current?.click()} disabled={uploading}>
                {uploading ? <Loader2 className="size-4 animate-spin" /> : <FileCode className="size-4" />}
                {uploading ? '处理中...' : '选择文件'}
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
