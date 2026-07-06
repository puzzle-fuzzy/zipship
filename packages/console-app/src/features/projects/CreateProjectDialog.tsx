import type { FormEvent } from 'react';
import { useState } from 'react';
import { useTranslation } from '../../i18n';
import { Button } from '../../shared/ui/Button';
import { Dialog } from '../../shared/ui/Dialog';
import { Input } from '../../shared/ui/Input';

interface CreateProjectDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated: (project: { name: string; slug: string; description: string }) => void;
}

export function CreateProjectDialog({ open, onClose, onCreated }: CreateProjectDialogProps) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');

    if (!name.trim()) {
      setError('Project name is required');
      return;
    }
    if (!slug.trim()) {
      setError('Project slug is required');
      return;
    }

    setLoading(true);
    try {
      onCreated({ name: name.trim(), slug: slug.trim(), description: description.trim() });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('projects.createFailed'));
    } finally {
      setLoading(false);
    }
  };

  const handleNameChange = (value: string) => {
    setName(value);
    const generated = value
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
    setSlug(generated);
  };

  return (
    <Dialog open={open} title={t('projects.create')} onClose={onClose} width={420}>
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {error && (
          <div
            style={{
              padding: '8px 12px',
              fontSize: 'var(--font-size-sm)',
              color: 'var(--color-error)',
              background: 'var(--color-error-bg)',
              borderRadius: 'var(--radius-md)',
            }}
          >
            {error}
          </div>
        )}
        <Input label={t('projects.name')} placeholder="My Project" value={name} onChange={handleNameChange} />
        <Input label={t('projects.slug')} placeholder="my-project" value={slug} onChange={setSlug} hint={t('projects.slugHint')} />
        <Input
          label={t('projects.description')}
          placeholder={t('projects.descriptionPlaceholder')}
          value={description}
          onChange={setDescription}
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
          <Button variant="secondary" type="button" onClick={onClose}>
            {t('projects.cancel')}
          </Button>
          <Button type="submit" disabled={loading || !name.trim() || !slug.trim()}>
            {loading ? t('projects.creating') : t('projects.create')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
