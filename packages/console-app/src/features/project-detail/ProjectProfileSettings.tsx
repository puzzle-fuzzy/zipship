import { useEffect, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { Button } from '../../components/primitives/button';
import { Field, FieldGroup, FieldLabel } from '../../components/primitives/field';
import { Input } from '../../components/primitives/input';
import { Textarea } from '../../components/primitives/textarea';
import { useTranslation } from '../../i18n';
import type { Project } from '../../stores/projectsStore';
import type { ProjectSettingsSaveInput } from './projectSettingsTypes';

interface ProjectProfileSettingsProps {
  canManage: boolean;
  project: Project;
  onSave: (input: ProjectSettingsSaveInput) => Promise<void>;
}

export function ProjectProfileSettings({
  canManage,
  project,
  onSave,
}: ProjectProfileSettingsProps) {
  const { t } = useTranslation();
  const [name, setName] = useState(project.name);
  const [slug, setSlug] = useState(project.slug);
  const [description, setDescription] = useState(project.description ?? '');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setName(project.name);
    setSlug(project.slug);
    setDescription(project.description ?? '');
  }, [project.id, project.name, project.slug, project.description]);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!canManage) return;

    setSaving(true);
    try {
      await onSave({ name, slug, description: description || null });
      toast.success(t('toast.settingsSaved'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('toast.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="rounded-lg border bg-card/92 p-4 shadow-sm">
      <div className="mb-4">
        <h2 className="font-semibold">{t('settings.profileTitle')}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('settings.projectPreferences')}
        </p>
      </div>
      <form className="flex flex-col gap-4" onSubmit={(event) => void handleSubmit(event)}>
        <FieldGroup>
          <div className="grid gap-3 md:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="project-name">{t('projects.name')}</FieldLabel>
              <Input
                id="project-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                disabled={!canManage}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="project-slug">{t('projects.slug')}</FieldLabel>
              <Input
                id="project-slug"
                value={slug}
                onChange={(event) => setSlug(event.target.value)}
                className="font-mono"
                disabled={!canManage}
              />
            </Field>
          </div>

          <Field>
            <FieldLabel htmlFor="project-description">{t('projects.description')}</FieldLabel>
            <Textarea
              id="project-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder={t('projects.descriptionPlaceholder')}
              className="field-sizing-fixed"
              rows={4}
              disabled={!canManage}
            />
          </Field>
        </FieldGroup>

        <div className="flex justify-end pt-2">
          <Button type="submit" disabled={!canManage || saving}>
            {saving ? t('toast.saving') : t('common.save')}
          </Button>
        </div>
      </form>
    </section>
  );
}
