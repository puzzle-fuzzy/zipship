import { type FormEvent, useState } from 'react';
import { useTranslation } from '../../i18n';
import { MaterialIcon } from '../../components/MaterialIcon';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/primitives/dialog';
import { Button } from '../../components/primitives/button';
import { Input } from '../../components/primitives/input';
import { Label } from '../../components/primitives/label';
import { Textarea } from '../../components/primitives/textarea';
import { projectNameSchema, projectSlugSchema } from '../../lib/validation';

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

    const nameResult = projectNameSchema.safeParse(name);
    if (!nameResult.success) {
      setError(nameResult.error.issues[0].message);
      return;
    }
    const slugResult = projectSlugSchema.safeParse(slug);
    if (!slugResult.success) {
      setError(slugResult.error.issues[0].message);
      return;
    }

    setLoading(true);
    try {
      await onCreated({ name: nameResult.data, slug: slugResult.data, description: description.trim() });
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
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg" closeLabel={t('common.close')}>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <div className="mb-2 flex size-10 items-center justify-center rounded-lg border bg-primary/10 text-primary">
              <MaterialIcon name="create_new_folder" />
            </div>
            <DialogTitle>{t('projects.create')}</DialogTitle>
            <DialogDescription>{t('projects.createDesc')}</DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4 py-4">
            {error && (
              <div className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </div>
            )}
            <div className="grid gap-2">
              <Label htmlFor="name">{t('projects.name')}</Label>
              <Input
                id="name"
                placeholder="My Project"
                value={name}
                onChange={(e) => handleNameChange(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="slug">{t('projects.slug')}</Label>
              <div className="relative">
                <MaterialIcon name="link" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[18px] text-muted-foreground" />
                <Input
                  id="slug"
                  className="pl-10 font-mono"
                  placeholder="my-project"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                />
              </div>
              <p className="text-xs text-muted-foreground">{t('projects.slugHint')}</p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="description">{t('projects.description')}</Label>
              <Textarea
                id="description"
                placeholder={t('projects.descriptionPlaceholder')}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" type="button" onClick={onClose}>
              {t('projects.cancel')}
            </Button>
            <Button type="submit" disabled={loading || !name.trim() || !slug.trim()}>
              {loading ? t('projects.creating') : t('projects.create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
