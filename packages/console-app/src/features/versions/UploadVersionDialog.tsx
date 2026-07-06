import { Upload } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from '../../i18n';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { Button } from '../../components/ui/button';

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
}: UploadVersionDialogProps) {
  const { t } = useTranslation();
  const [loading] = useState(false);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('versions.uploadTitle')}</DialogTitle>
          <DialogDescription>
            Select a ZIP file to upload and deploy
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col items-center gap-4 py-6">
          <div className="flex size-12 items-center justify-center rounded-lg bg-muted">
            <Upload className="size-6 text-muted-foreground" />
          </div>
          <p className="text-sm text-muted-foreground text-center">
            Select a ZIP file to upload and deploy
          </p>
          <Button disabled={loading}>
            <Upload className="size-4" />
            {loading ? t('versions.uploading') : t('versions.chooseFile')}
          </Button>
          <input type="file" accept=".zip" className="hidden" />
        </div>
      </DialogContent>
    </Dialog>
  );
}
