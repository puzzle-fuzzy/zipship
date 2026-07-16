import { CheckCircle2, Clock3, ExternalLink, Rocket, UploadCloud } from 'lucide-react';
import { Button } from '../../components/primitives/button';
import { useTranslation } from '../../i18n';
import type { Release } from '../../stores/projectsStore';
import { parseReleaseReport } from './releaseReport';

interface ProjectVersionsOverviewProps {
  activeRelease: Release | null;
  canUpload: boolean;
  releases: Release[];
  onPreview: (release: Release) => void;
  onUploadClick: () => void;
}

export function ProjectVersionsOverview({
  activeRelease,
  canUpload,
  releases,
  onPreview,
  onUploadClick,
}: ProjectVersionsOverviewProps) {
  const { t } = useTranslation();
  const latestRelease = releases[0] ?? null;
  const latestReport = latestRelease ? parseReleaseReport(latestRelease.detectResult) : null;
  const readyCount = releases.filter((release) => release.status === 'ready').length;
  const processingCount = releases.filter(
    (release) => release.status === 'uploading' || release.status === 'processing',
  ).length;
  const failedCount = releases.filter((release) => release.status === 'failed').length;

  return (
    <div className="grid gap-3 lg:grid-cols-[1.25fr_0.85fr_0.9fr]">
      <section className="rounded-lg border bg-card/92 p-4 shadow-sm">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
              {t('versions.liveRelease')}
            </p>
            <h2 className="mt-1 text-lg font-semibold">
              {activeRelease ? `v${activeRelease.versionNumber}` : t('versions.noLiveRelease')}
            </h2>
          </div>
          <span className="rounded-lg border bg-primary/10 p-2 text-primary">
            <Rocket className="size-4" />
          </span>
        </div>
        <div className="min-h-12 text-sm text-muted-foreground">
          {activeRelease ? (
            <div className="flex flex-col gap-1">
              <p className="font-mono text-xs text-foreground">{activeRelease.releaseHash}</p>
              <p>
                {t('versions.files', { count: activeRelease.fileCount })} /{' '}
                {t('versions.size', { size: Math.round(activeRelease.totalSize / 1024) })}
              </p>
            </div>
          ) : (
            <p>{t('versions.noLiveReleaseDesc')}</p>
          )}
        </div>
        <div className="mt-4 flex gap-2">
          {activeRelease ? (
            <Button variant="outline" size="sm" onClick={() => onPreview(activeRelease)}>
              <ExternalLink data-icon="inline-start" />
              {t('versions.preview')}
            </Button>
          ) : null}
          <Button size="sm" disabled={!canUpload} onClick={onUploadClick}>
            <UploadCloud data-icon="inline-start" />
            {t('versions.upload')}
          </Button>
        </div>
      </section>

      <section className="rounded-lg border bg-card/92 p-4 shadow-sm">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
              {t('versions.readyQueue')}
            </p>
            <h2 className="mt-1 text-lg font-semibold">{readyCount}</h2>
          </div>
          <span className="rounded-lg border bg-muted p-2 text-muted-foreground">
            <CheckCircle2 className="size-4" />
          </span>
        </div>
        <p className="text-sm text-muted-foreground">
          {processingCount > 0
            ? t('versions.processingCount', { count: processingCount })
            : t('versions.readyQueueDesc', { count: failedCount })}
        </p>
      </section>

      <section className="rounded-lg border bg-card/92 p-4 shadow-sm">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
              {t('versions.latestCheck')}
            </p>
            <h2 className="mt-1 text-lg font-semibold">
              {latestReport && latestReport.level !== 'unknown'
                ? t(`releaseReport.runtimeLevels.${latestReport.level}`)
                : '-'}
            </h2>
          </div>
          <span className="rounded-lg border bg-muted p-2 text-muted-foreground">
            <Clock3 className="size-4" />
          </span>
        </div>
        <p className="text-sm text-muted-foreground">
          {latestRelease
            ? t('versions.latestVersion', { version: latestRelease.versionNumber })
            : t('versions.empty')}
        </p>
      </section>
    </div>
  );
}
