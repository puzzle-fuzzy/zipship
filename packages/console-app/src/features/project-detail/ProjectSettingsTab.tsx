import { buildAccessPlanePreview } from "@zipship/shared";
import {
  Globe2,
  LockKeyhole,
  Route,
  ShieldAlert,
  ShieldCheck,
  TimerReset,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useTranslation } from "../../i18n";
import { Button } from "../../components/ui/button";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "../../components/ui/field";
import { Input } from "../../components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import { Switch } from "../../components/ui/switch";
import { Textarea } from "../../components/ui/textarea";
import type { Project, Release } from "../../stores/projectsStore";
import { buildProjectProductionPaths } from "./projectSettingsModel";

type ProjectSettingsSaveInput = {
  name?: string;
  slug?: string;
  description?: string | null;
  spaFallback?: boolean;
  cachePolicy?: "standard" | "aggressive";
};

interface ProjectSettingsTabProps {
  project: Project;
  activeRelease: Release | undefined;
  canManage: boolean;
  /** Persist the edit; resolves on success, rejects on failure. The tab toasts. */
  onSave: (input: ProjectSettingsSaveInput) => Promise<void>;
}

export function ProjectSettingsTab({
  project,
  activeRelease,
  canManage,
  onSave,
}: ProjectSettingsTabProps) {
  const { t } = useTranslation();
  const [editingName, setEditingName] = useState(project.name);
  const [editingSlug, setEditingSlug] = useState(project.slug);
  const [editingDesc, setEditingDesc] = useState(project.description ?? "");
  const [editingSpaFallback, setEditingSpaFallback] = useState(project.spaFallback);
  const [editingCachePolicy, setEditingCachePolicy] = useState(project.cachePolicy);
  const [saving, setSaving] = useState(false);
  const [savingProduction, setSavingProduction] = useState(false);
  const productionPaths = buildProjectProductionPaths(project.slug, activeRelease);
  const accessPreview = buildAccessPlanePreview({
    slug: project.slug,
    spaFallback: editingSpaFallback,
    cachePolicy: editingCachePolicy,
    customDomains: [],
  });

  // Re-seed the form if a different project mounts into the same instance.
  useEffect(() => {
    setEditingName(project.name);
    setEditingSlug(project.slug);
    setEditingDesc(project.description ?? "");
    setEditingSpaFallback(project.spaFallback);
    setEditingCachePolicy(project.cachePolicy);
  }, [
    project.id,
    project.name,
    project.slug,
    project.description,
    project.spaFallback,
    project.cachePolicy,
  ]);

  const handleSaveProductionAccess = async () => {
    if (!canManage) return;

    setSavingProduction(true);
    try {
      await onSave({
        spaFallback: editingSpaFallback,
        cachePolicy: editingCachePolicy,
      });
      toast.success(t("toast.settingsSaved"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("toast.saveFailed"));
    } finally {
      setSavingProduction(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-lg border bg-card/92 p-4 shadow-sm">
        <div className="mb-4">
          <h2 className="font-semibold">{t("settings.profileTitle")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t("settings.projectPreferences")}</p>
        </div>
        <form
          className="flex flex-col gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!canManage) return;
            setSaving(true);
            try {
              await onSave({
                name: editingName,
                slug: editingSlug,
                description: editingDesc || null,
              });
              toast.success(t("toast.settingsSaved"));
            } catch (err) {
              toast.error(err instanceof Error ? err.message : t("toast.saveFailed"));
            } finally {
              setSaving(false);
            }
          }}
        >
          <FieldGroup>
            <div className="grid gap-3 md:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="project-name">{t("projects.name")}</FieldLabel>
                <Input
                  id="project-name"
                  value={editingName}
                  onChange={(e) => setEditingName(e.target.value)}
                  disabled={!canManage}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="project-slug">{t("projects.slug")}</FieldLabel>
                <Input
                  id="project-slug"
                  value={editingSlug}
                  onChange={(e) => setEditingSlug(e.target.value)}
                  className="font-mono"
                  disabled={!canManage}
                />
              </Field>
            </div>

            <Field>
              <FieldLabel htmlFor="project-description">{t("projects.description")}</FieldLabel>
              <Textarea
                id="project-description"
                value={editingDesc}
                onChange={(e) => setEditingDesc(e.target.value)}
                placeholder={t("projects.descriptionPlaceholder")}
                className="field-sizing-fixed"
                rows={4}
                disabled={!canManage}
              />
            </Field>
          </FieldGroup>

          <div className="flex justify-end pt-2">
            <Button type="submit" disabled={!canManage || saving}>
              {saving ? t("toast.saving") : t("common.save")}
            </Button>
          </div>
        </form>
      </section>

      <section className="rounded-lg border bg-card/92 p-4 shadow-sm">
        <div className="mb-4 flex items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border bg-primary/10 text-primary">
            <Globe2 className="size-4" />
          </span>
          <div>
            <h2 className="font-semibold">{t("settings.productionTitle")}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{t("settings.productionDesc")}</p>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <PathLine label={t("settings.livePath")} value={productionPaths.livePath} />
          <PathLine
            label={t("settings.pinnedPath")}
            value={productionPaths.pinnedPath ?? t("settings.noDeployed")}
          />
        </div>

        <form
          className="mt-4 flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void handleSaveProductionAccess();
          }}
        >
          <FieldGroup>
            <div className="grid gap-3 lg:grid-cols-2">
              <Field orientation="horizontal" data-disabled={!canManage}>
                <Switch
                  id="spa-fallback"
                  checked={editingSpaFallback}
                  onCheckedChange={setEditingSpaFallback}
                  disabled={!canManage}
                />
                <FieldContent>
                  <FieldLabel htmlFor="spa-fallback">{t("settings.spaFallbackTitle")}</FieldLabel>
                  <FieldDescription>{t("settings.spaFallbackDesc")}</FieldDescription>
                </FieldContent>
              </Field>

              <Field>
                <FieldLabel htmlFor="cache-policy">{t("settings.cachePolicyTitle")}</FieldLabel>
                <Select
                  value={editingCachePolicy}
                  onValueChange={(value) =>
                    setEditingCachePolicy(value as "standard" | "aggressive")
                  }
                  disabled={!canManage}
                >
                  <SelectTrigger id="cache-policy" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="standard">{t("settings.cacheStandard")}</SelectItem>
                      <SelectItem value="aggressive">{t("settings.cacheAggressive")}</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <FieldDescription>{t("settings.cachePolicyDesc")}</FieldDescription>
              </Field>
            </div>

          </FieldGroup>

          <div className="flex flex-col gap-3 rounded-lg border bg-muted/20 p-3 md:flex-row">
            <PolicyItem
              icon={Route}
              title={t("settings.spaFallbackTitle")}
              description={
                accessPreview.missingAssetBehavior === "index"
                  ? t("settings.spaFallbackOn")
                  : t("settings.spaFallbackOff")
              }
              value={
                accessPreview.missingAssetBehavior === "index"
                  ? t("settings.enabledByAccessPlane")
                  : t("settings.disabled")
              }
            />
            <PolicyItem
              icon={TimerReset}
              title={t("settings.cachePolicyTitle")}
              description={
                editingCachePolicy === "aggressive"
                  ? t("settings.cacheAggressiveDesc")
                  : t("settings.cacheStandardDesc")
              }
              value={
                editingCachePolicy === "aggressive"
                  ? t("settings.cacheAggressive")
                  : t("settings.cacheStandard")
              }
            />
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <PolicyItem
              icon={TimerReset}
              title={t("settings.htmlCacheTitle")}
              description={t("settings.htmlCacheDesc")}
              value={accessPreview.htmlCacheControl}
            />
            <PolicyItem
              icon={TimerReset}
              title={t("settings.assetCacheTitle")}
              description={t("settings.assetCacheDesc")}
              value={accessPreview.assetCacheControl}
            />
          </div>

          {accessPreview.warnings.length > 0 && (
            <div className="flex flex-col gap-2 rounded-lg border bg-muted/20 p-3">
              {accessPreview.warnings.map((warning) => (
                <PolicyItem
                  key={warning.code}
                  icon={ShieldAlert}
                  title={t(`settings.accessWarnings.${warning.code}.title`)}
                  description={t(`settings.accessWarnings.${warning.code}.desc`)}
                  value={t(`settings.warningSeverity.${warning.severity}`)}
                />
              ))}
            </div>
          )}

          <div className="flex justify-end pt-1">
            <Button type="submit" disabled={!canManage || savingProduction}>
              {savingProduction ? t("toast.saving") : t("settings.saveProductionAccess")}
            </Button>
          </div>
        </form>

        <div className="mt-4 grid gap-3">
          <PolicyItem
            icon={LockKeyhole}
            title={t("settings.reservedPathsTitle")}
            description={t("settings.reservedPathsDesc")}
            value="/_api, /_sites"
          />
        </div>
      </section>
    </div>
  );
}

function PathLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg border bg-muted/25 p-3">
      <div className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">{label}</div>
      <code className="mt-1 block truncate font-mono text-xs">{value}</code>
    </div>
  );
}

function PolicyItem({
  icon: Icon,
  title,
  description,
  value,
}: {
  icon: typeof ShieldCheck;
  title: string;
  description: string;
  value: string;
}) {
  return (
    <div className="flex min-w-0 gap-3 rounded-lg border bg-background/55 p-3">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border bg-muted text-muted-foreground">
        <Icon className="size-4" />
      </span>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-medium">{title}</h3>
          <span className="rounded-md border bg-muted/40 px-1.5 py-0.5 text-xs text-muted-foreground">
            {value}
          </span>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}
