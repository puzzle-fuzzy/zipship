import { Globe2, LockKeyhole, Route, ShieldAlert, TimerReset } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { toast } from '../../lib/toast';
import { Button } from '../../components/primitives/button';
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from '../../components/primitives/field';
import { Select } from '../../components/primitives/select';
import { Switch } from '../../components/primitives/switch';
import { useTranslation } from '../../i18n';
import type { Project, Release } from '../../stores/projectsStore';
import {
  buildAccessPlanePolicyPreview,
  buildProjectProductionPaths,
  type AccessPlaneCachePolicy,
} from './projectSettingsModel';
import { ProjectPathLine, ProjectPolicyItem } from './ProjectSettingsItem';
import type { ProjectSettingsSaveInput } from './projectSettingsTypes';

interface ProjectProductionAccessSettingsProps {
  activeRelease: Release | undefined;
  canManage: boolean;
  project: Project;
  onSave: (input: ProjectSettingsSaveInput) => Promise<void>;
}

export function ProjectProductionAccessSettings({
  activeRelease,
  canManage,
  project,
  onSave,
}: ProjectProductionAccessSettingsProps) {
  const { t } = useTranslation();
  const [spaFallback, setSpaFallback] = useState(project.spaFallback);
  const [cachePolicy, setCachePolicy] = useState(project.cachePolicy);
  const [saving, setSaving] = useState(false);
  const productionPaths = buildProjectProductionPaths(project.slug, activeRelease);
  const accessPreview = buildAccessPlanePolicyPreview({ spaFallback, cachePolicy });

  useEffect(() => {
    setSpaFallback(project.spaFallback);
    setCachePolicy(project.cachePolicy);
  }, [project.id, project.spaFallback, project.cachePolicy]);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!canManage) return;

    setSaving(true);
    try {
      await onSave({ spaFallback, cachePolicy });
      toast.success(t('toast.settingsSaved'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('toast.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="rounded-lg border bg-card/92 p-4 shadow-sm">
      <div className="mb-4 flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border bg-primary/10 text-primary">
          <Globe2 className="size-4" />
        </span>
        <div>
          <h2 className="font-semibold">{t('settings.productionTitle')}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t('settings.productionDesc')}</p>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <ProjectPathLine label={t('settings.livePath')} value={productionPaths.livePath} />
        <ProjectPathLine
          label={t('settings.pinnedPath')}
          value={productionPaths.pinnedPath ?? t('settings.noDeployed')}
        />
      </div>

      <form className="mt-4 flex flex-col gap-4" onSubmit={(event) => void handleSubmit(event)}>
        <FieldGroup>
          <div className="grid gap-3 lg:grid-cols-2">
            <Field orientation="horizontal" data-disabled={!canManage}>
              <Switch
                id="spa-fallback"
                checked={spaFallback}
                onCheckedChange={setSpaFallback}
                disabled={!canManage}
              />
              <FieldContent>
                <FieldLabel htmlFor="spa-fallback">{t('settings.spaFallbackTitle')}</FieldLabel>
                <FieldDescription>{t('settings.spaFallbackDesc')}</FieldDescription>
              </FieldContent>
            </Field>

            <Field>
              <FieldLabel htmlFor="cache-policy">{t('settings.cachePolicyTitle')}</FieldLabel>
              <Select
                id="cache-policy"
                className="w-full"
                value={cachePolicy}
                onValueChange={(value) => setCachePolicy(cachePolicyValue(value))}
                disabled={!canManage}
              >
                <option value="standard">{t('settings.cacheStandard')}</option>
                <option value="aggressive">{t('settings.cacheAggressive')}</option>
              </Select>
              <FieldDescription>{t('settings.cachePolicyDesc')}</FieldDescription>
            </Field>
          </div>
        </FieldGroup>

        <div className="flex flex-col gap-3 rounded-lg border bg-muted/20 p-3 md:flex-row">
          <ProjectPolicyItem
            icon={Route}
            title={t('settings.spaFallbackTitle')}
            description={
              accessPreview.missingAssetBehavior === 'index'
                ? t('settings.spaFallbackOn')
                : t('settings.spaFallbackOff')
            }
            value={
              accessPreview.missingAssetBehavior === 'index'
                ? t('settings.enabledByAccessPlane')
                : t('settings.disabled')
            }
          />
          <ProjectPolicyItem
            icon={TimerReset}
            title={t('settings.cachePolicyTitle')}
            description={
              cachePolicy === 'aggressive'
                ? t('settings.cacheAggressiveDesc')
                : t('settings.cacheStandardDesc')
            }
            value={
              cachePolicy === 'aggressive'
                ? t('settings.cacheAggressive')
                : t('settings.cacheStandard')
            }
          />
        </div>

        <div className="grid gap-3 lg:grid-cols-2">
          <ProjectPolicyItem
            icon={TimerReset}
            title={t('settings.htmlCacheTitle')}
            description={t('settings.htmlCacheDesc')}
            value={accessPreview.htmlCacheControl}
          />
          <ProjectPolicyItem
            icon={TimerReset}
            title={t('settings.assetCacheTitle')}
            description={t('settings.assetCacheDesc')}
            value={accessPreview.assetCacheControl}
          />
        </div>

        {accessPreview.warnings.length > 0 ? (
          <div className="flex flex-col gap-2 rounded-lg border bg-muted/20 p-3">
            {accessPreview.warnings.map((warning) => (
              <ProjectPolicyItem
                key={warning.code}
                icon={ShieldAlert}
                title={t(`settings.accessWarnings.${warning.code}.title`)}
                description={t(`settings.accessWarnings.${warning.code}.desc`)}
                value={t(`settings.warningSeverity.${warning.severity}`)}
              />
            ))}
          </div>
        ) : null}

        <div className="flex justify-end pt-1">
          <Button type="submit" disabled={!canManage || saving}>
            {saving ? t('toast.saving') : t('settings.saveProductionAccess')}
          </Button>
        </div>
      </form>

      <div className="mt-4 grid gap-3">
        <ProjectPolicyItem
          icon={LockKeyhole}
          title={t('settings.reservedPathsTitle')}
          description={t('settings.reservedPathsDesc')}
          value="/_api, /_sites"
        />
      </div>
    </section>
  );
}

function cachePolicyValue(value: string): AccessPlaneCachePolicy {
  if (value === 'standard' || value === 'aggressive') return value;
  throw new Error(`Unsupported cache policy selection: ${value}`);
}
