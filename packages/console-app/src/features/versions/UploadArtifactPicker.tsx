import { Archive, CheckCircle2, FileCode, FileUp, FolderOpen, ShieldCheck, Upload } from 'lucide-react';
import { useRef, useState, type ChangeEvent } from 'react';
import { Badge } from '../../components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs';
import { useTranslation } from '../../i18n';
import type { UploadMode } from './uploadDialogModel';

interface UploadArtifactPickerProps {
  open: boolean;
  onClose: () => void;
  onFolderSelected: (files: File[]) => void;
  onSingleFileSelected: (file: File) => void;
  onZipSelected: (file: File) => void;
}

export function UploadArtifactPicker({
  open,
  onClose,
  onFolderSelected,
  onSingleFileSelected,
  onZipSelected,
}: UploadArtifactPickerProps) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<UploadMode>('zip');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const singleFileInputRef = useRef<HTMLInputElement>(null);

  const resetInputs = () => {
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (folderInputRef.current) folderInputRef.current.value = '';
    if (singleFileInputRef.current) singleFileInputRef.current.value = '';
  };

  const handleClose = () => {
    resetInputs();
    onClose();
  };

  const handleZipFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) onZipSelected(file);
  };

  const handleFolder = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    if (files.length > 0) onFolderSelected(files);
  };

  const handleSingleFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) onSingleFileSelected(file);
  };

  const modeCards = [
    {
      mode: 'zip' as const,
      icon: FileUp,
      label: t('upload.zip'),
      description: t('upload.chooseZipDesc'),
      actionLabel: t('versions.chooseFile'),
      onSelect: () => fileInputRef.current?.click(),
      badge: t('upload.recommended'),
    },
    {
      mode: 'folder' as const,
      icon: FolderOpen,
      label: t('upload.folder'),
      description: t('upload.chooseFolderDesc'),
      actionLabel: t('upload.chooseFolder'),
      onSelect: () => folderInputRef.current?.click(),
    },
    {
      mode: 'file' as const,
      icon: FileCode,
      label: t('upload.singleFile'),
      description: t('upload.chooseFileDesc'),
      actionLabel: t('upload.chooseFile'),
      onSelect: () => singleFileInputRef.current?.click(),
    },
  ];

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && handleClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <div className="mb-2 flex size-10 items-center justify-center rounded-lg border bg-primary/10 text-primary">
            <Upload className="size-5" />
          </div>
          <DialogTitle>{t('versions.uploadTitle')}</DialogTitle>
          <DialogDescription>{t('upload.chooseZipFolderFile')}</DialogDescription>
        </DialogHeader>

        <Tabs value={mode} onValueChange={(value) => setMode(value as UploadMode)}>
          <TabsList className="w-full">
            {modeCards.map((card) => (
              <TabsTrigger key={card.mode} value={card.mode} className="flex-1 gap-1.5">
                <card.icon data-icon="inline-start" />
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
                <span className="flex w-full items-start justify-between gap-4">
                  <span className="flex min-w-0 items-start gap-3">
                    <span className="flex size-11 shrink-0 items-center justify-center rounded-lg border bg-muted text-muted-foreground transition-colors group-hover:text-primary">
                      <card.icon />
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
                  </span>
                  <span className="shrink-0 rounded-lg border bg-background p-2 text-muted-foreground transition-colors group-hover:text-primary">
                    <Upload />
                  </span>
                </span>
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

        <input ref={fileInputRef} type="file" accept=".zip" className="hidden" onChange={handleZipFile} />
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
