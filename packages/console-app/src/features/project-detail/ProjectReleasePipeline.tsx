import { BarChart3, ExternalLink, MoreHorizontal, Plus, Rocket } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '../../components/primitives/badge';
import { Button } from '../../components/primitives/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../components/primitives/dropdown-menu';
import { Separator } from '../../components/primitives/separator';
import { useTranslation } from '../../i18n';
import { cn } from '../../lib/utils';
import type { Release } from '../../stores/projectsStore';
import { ProjectReleaseReport } from './ProjectReleaseReport';
import { parseReleaseReport } from './releaseReport';
import { releaseStatusBadgeClass, releaseStatusLabel } from './releaseStatus';

interface ProjectReleasePipelineProps {
  activeRelease: Release | null;
  canDelete: boolean;
  canDeploy: boolean;
  canUpload: boolean;
  deploymentLoading: boolean;
  highlightedReleaseId: string | null;
  releases: Release[];
  onDeploy: (release: Release) => void;
  onPreview: (release: Release) => void;
  onUploadClick: () => void;
}

export function ProjectReleasePipeline({
  activeRelease,
  canDelete,
  canDeploy,
  canUpload,
  deploymentLoading,
  highlightedReleaseId,
  releases,
  onDeploy,
  onPreview,
  onUploadClick,
}: ProjectReleasePipelineProps) {
  const { t } = useTranslation();
  const [expandedReleaseId, setExpandedReleaseId] = useState<string | null>(null);

  useEffect(() => {
    if (highlightedReleaseId) setExpandedReleaseId(highlightedReleaseId);
  }, [highlightedReleaseId]);

  return (
    <div className="overflow-hidden rounded-lg border bg-card/92 shadow-sm">
      <div className="flex flex-col gap-3 border-b bg-muted/20 px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-semibold">{t('versions.deploymentPipeline')}</h2>
          <p className="text-xs text-muted-foreground">
            {t('versions.total', { count: releases.length })}
          </p>
        </div>
        <Button
          size="sm"
          className="min-h-10 sm:min-h-7"
          disabled={!canUpload}
          onClick={onUploadClick}
        >
          <Plus data-icon="inline-start" />
          {t('toast.publishVersion')}
        </Button>
      </div>

      {releases.map((release, index) => {
        const report = parseReleaseReport(release.detectResult);
        const deploymentAction =
          activeRelease && release.versionNumber < activeRelease.versionNumber
            ? 'rollback'
            : 'publish';
        const isHighlighted = highlightedReleaseId === release.id;

        return (
          <div key={release.id}>
            <div
              className={cn(
                'grid gap-3 px-3 py-3.5 transition-colors hover:bg-muted/45 md:grid-cols-[1fr_auto] md:items-center',
                isHighlighted &&
                  'bg-primary/5 ring-1 ring-inset ring-primary/20 hover:bg-primary/10',
              )}
            >
              <div className="flex min-w-0 items-start gap-3">
                <span
                  className={cn(
                    'mt-1 size-2.5 shrink-0 rounded-full ring-4',
                    release.status === 'active'
                      ? 'bg-primary ring-primary/10'
                      : release.status === 'failed'
                        ? 'bg-destructive ring-destructive/10'
                        : 'bg-muted-foreground ring-muted',
                  )}
                />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm tracking-tight">
                      v{release.versionNumber}
                      {release.releaseHash ? (
                        <span className="ml-1 text-muted-foreground">
                          ({release.releaseHash})
                        </span>
                      ) : null}
                    </span>
                    <span
                      className={`inline-flex shrink-0 rounded-md border px-1.5 py-0.5 text-xs font-semibold uppercase leading-none tracking-[0.06em] ${releaseStatusBadgeClass(release.status)}`}
                    >
                      {releaseStatusLabel(release.status, t)}
                    </span>
                    {isHighlighted ? (
                      <Badge variant="secondary" className="rounded-md">
                        {t('versions.justUploaded')}
                      </Badge>
                    ) : null}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span>{t('versions.files', { count: release.fileCount })}</span>
                    <span>
                      {t('versions.size', { size: Math.round(release.totalSize / 1024) })}
                    </span>
                    <span>
                      {report.seoScore === null
                        ? t('releaseReport.noSeoScore')
                        : t('releaseReport.seoScore', { score: report.seoScore })}
                    </span>
                    {report.runtime ? (
                      <span>{t(`releaseReport.runtimeLevels.${report.runtime.level}`)}</span>
                    ) : null}
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 md:justify-end">
                <Button
                  variant="outline"
                  size="sm"
                  className="min-h-10 flex-1 sm:min-h-7 sm:flex-none"
                  onClick={() => onPreview(release)}
                >
                  <ExternalLink data-icon="inline-start" />
                  {t('versions.preview')}
                </Button>
                {release.status === 'ready' ? (
                  <Button
                    size="sm"
                    className="min-h-10 flex-1 sm:min-h-7 sm:flex-none"
                    disabled={!canDeploy || deploymentLoading}
                    onClick={() => onDeploy(release)}
                  >
                    <Rocket data-icon="inline-start" />
                    {deploymentAction === 'rollback'
                      ? t('versions.rollback')
                      : t('versions.publish')}
                  </Button>
                ) : null}
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="size-10 sm:size-7"
                  aria-label={t('releaseReport.toggle')}
                  onClick={() =>
                    setExpandedReleaseId((current) =>
                      current === release.id ? null : release.id,
                    )
                  }
                >
                  <BarChart3 />
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button variant="ghost" size="icon-sm" className="size-10 sm:size-7" />
                    }
                  >
                    <MoreHorizontal />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" sideOffset={6} className="min-w-40">
                    <DropdownMenuItem
                      disabled={!canDelete}
                      className="text-destructive"
                      onClick={() => toast.info(t('toast.deleteVersionSoon'))}
                    >
                      {t('versions.delete')}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
            {expandedReleaseId === release.id ? <ProjectReleaseReport release={release} /> : null}
            {index < releases.length - 1 ? <Separator /> : null}
          </div>
        );
      })}
    </div>
  );
}
