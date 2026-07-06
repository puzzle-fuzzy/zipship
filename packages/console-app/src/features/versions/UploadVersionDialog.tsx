import { IconUpload } from '@tabler/icons-react';
import { useState } from 'react';
import { useTranslation } from '../../i18n';
import { Dialog } from '../../shared/ui/Dialog';

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
    <Dialog open={open} title={t('versions.uploadTitle')} onClose={onClose} width={480}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, alignItems: 'center', padding: '24px 0' }}>
        <IconUpload size={40} style={{ color: 'var(--color-text-tertiary)' }} />
        <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', textAlign: 'center' }}>
          Select a ZIP file to upload and deploy
        </p>
        <label
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 20px',
            background: 'var(--color-accent)',
            color: 'var(--color-text-inverse)',
            borderRadius: 'var(--radius-md)',
            cursor: 'pointer',
            fontWeight: 500,
            fontSize: 'var(--font-size-sm)',
            opacity: loading ? 0.5 : 1,
          }}
        >
          <IconUpload size={16} />
          {loading ? t('versions.uploading') : t('versions.chooseFile')}
          <input type="file" accept=".zip" style={{ display: 'none' }} />
        </label>
      </div>
    </Dialog>
  );
}
