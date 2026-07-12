import {
  BarChart3,
  CheckCircle2,
  Clock3,
  ExternalLink,
  Info,
  MoreHorizontal,
  Plus,
  Rocket,
  UploadCloud,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "../../components/ui/alert";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu";
import { Separator } from "../../components/ui/separator";
import { Skeleton } from "../../components/ui/skeleton";
import { useTranslation } from "../../i18n";
import { cn } from "../../lib/utils";
import type { Release } from "../../stores/projectsStore";
import { DeploymentConfirmDialog, type DeploymentIntent } from "./DeploymentConfirmDialog";
import { ProjectReleaseReport } from "./ProjectReleaseReport";
import { parseReleaseReport } from "./releaseReport";
import { releaseStatusBadgeClass, releaseStatusLabel } from "./releaseStatus";

interface ProjectVersionsTabProps {
  releases: Release[];
  loading: boolean;
  error: string | null;
  autoRefreshing: boolean;
  highlightedReleaseId?: string | null;
  canUpload: boolean;
  canDeploy: boolean;
  canDelete: boolean;
  onUploadClick: () => void;
  onRetry: () => void;
  onPreview: (release: Release) => void;
  /** Perform the publish; resolves on success, rejects on failure. The tab toasts. */
  onPublish: (release: Release, message?: string | null) => Promise<void>;
  /** Perform a rollback to a previous ready release. */
  onRollback: (release: Release, message?: string | null) => Promise<void>;
}

export function ProjectVersionsTab({
  releases,
  loading,
  error,
  autoRefreshing,
  highlightedReleaseId = null,
  canUpload,
  canDeploy,
  canDelete,
  onUploadClick,
  onRetry,
  onPreview,
  onPublish,
  onRollback,
}: ProjectVersionsTabProps) {
  const { t } = useTranslation();
  const [expandedReleaseId, setExpandedReleaseId] = useState<string | null>(null);
  const [deploymentIntent, setDeploymentIntent] = useState<DeploymentIntent | null>(null);
  const [deploymentLoading, setDeploymentLoading] = useState(false);
  const [deploymentMessage, setDeploymentMessage] = useState("");
  const activeRelease = releases.find((release) => release.status === "active") ?? null;
  const latestRelease = releases[0] ?? null;
  const readyReleases = releases.filter((release) => release.status === "ready");
  const processingCount = releases.filter(
    (release) => release.status === "uploading" || release.status === "processing",
  ).length;
  const failedCount = releases.filter((release) => release.status === "failed").length;
  const latestReport = latestRelease ? parseReleaseReport(latestRelease.detectResult) : null;

  useEffect(() => {
    if (highlightedReleaseId) {
      setExpandedReleaseId(highlightedReleaseId);
    }
  }, [highlightedReleaseId]);

  const openDeploymentConfirm = (release: Release) => {
    const action =
      activeRelease && release.versionNumber < activeRelease.versionNumber ? "rollback" : "publish";
    setDeploymentMessage("");
    setDeploymentIntent({ action, release });
  };

  const confirmDeployment = async () => {
    if (!deploymentIntent) return;

    setDeploymentLoading(true);
    const message = deploymentMessage.trim() || null;
    try {
      if (deploymentIntent.action === "rollback") {
        await onRollback(deploymentIntent.release, message);
        toast.success(t("toast.rolledBack"));
      } else {
        await onPublish(deploymentIntent.release, message);
        toast.success(t("toast.published"));
      }
      setDeploymentMessage("");
      setDeploymentIntent(null);
    } catch (err) {
      const fallback =
        deploymentIntent.action === "rollback" ? t("toast.rollbackFailed") : t("toast.publishFailed");
      toast.error(err instanceof Error ? err.message : fallback);
    } finally {
      setDeploymentLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-3 rounded-lg border bg-card/70 p-4">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <Info className="size-4" />
        <AlertTitle>{t("versions.loadFailedTitle")}</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
        <AlertAction>
          <Button size="sm" variant="outline" onClick={onRetry}>
            {t("common.retry")}
          </Button>
        </AlertAction>
      </Alert>
    );
  }

  if (releases.length === 0) {
    return (
      <div className="flex flex-col gap-3 rounded-lg border border-dashed bg-card/70 p-8 text-center text-sm text-muted-foreground">
        <div className="font-medium text-foreground">{t("versions.empty")}</div>
        <p>{canUpload ? t("versions.emptyDesc") : t("versions.noUploadPermission")}</p>
        <div>
          <Button disabled={!canUpload} onClick={onUploadClick}>
            <Plus className="size-4" />
            {t("toast.publishVersion")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {!canDeploy && readyReleases.length > 0 ? (
        <Alert>
          <Info className="size-4" />
          <AlertTitle>{t("versions.deployPermissionTitle")}</AlertTitle>
          <AlertDescription>{t("versions.deployPermissionDesc")}</AlertDescription>
        </Alert>
      ) : null}

      {autoRefreshing ? (
        <Alert>
          <Clock3 className="size-4" />
          <AlertTitle>{t("versions.refreshingTitle")}</AlertTitle>
          <AlertDescription>{t("versions.refreshingDesc")}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-3 lg:grid-cols-[1.25fr_0.85fr_0.9fr]">
        <section className="rounded-lg border bg-card/92 p-4 shadow-sm">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                {t("versions.liveRelease")}
              </p>
              <h2 className="mt-1 text-lg font-semibold">
                {activeRelease ? `v${activeRelease.versionNumber}` : t("versions.noLiveRelease")}
              </h2>
            </div>
            <span className="rounded-lg border bg-primary/10 p-2 text-primary">
              <Rocket className="size-4" />
            </span>
          </div>
          <div className="min-h-12 text-sm text-muted-foreground">
            {activeRelease ? (
              <div className="space-y-1">
                <p className="font-mono text-xs text-foreground">{activeRelease.releaseHash}</p>
                <p>
                  {t("versions.files", { count: activeRelease.fileCount })} /{" "}
                  {t("versions.size", { size: Math.round(activeRelease.totalSize / 1024) })}
                </p>
              </div>
            ) : (
              <p>{t("versions.noLiveReleaseDesc")}</p>
            )}
          </div>
          <div className="mt-4 flex gap-2">
            {activeRelease ? (
              <Button variant="outline" size="sm" onClick={() => onPreview(activeRelease)}>
                <ExternalLink className="size-4" />
                {t("versions.preview")}
              </Button>
            ) : null}
            <Button size="sm" disabled={!canUpload} onClick={onUploadClick}>
              <UploadCloud className="size-4" />
              {t("versions.upload")}
            </Button>
          </div>
        </section>

        <section className="rounded-lg border bg-card/92 p-4 shadow-sm">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                {t("versions.readyQueue")}
              </p>
              <h2 className="mt-1 text-lg font-semibold">{readyReleases.length}</h2>
            </div>
            <span className="rounded-lg border bg-muted p-2 text-muted-foreground">
              <CheckCircle2 className="size-4" />
            </span>
          </div>
          <p className="text-sm text-muted-foreground">
            {processingCount > 0
              ? t("versions.processingCount", { count: processingCount })
              : t("versions.readyQueueDesc", { count: failedCount })}
          </p>
        </section>

        <section className="rounded-lg border bg-card/92 p-4 shadow-sm">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                {t("versions.latestCheck")}
              </p>
              <h2 className="mt-1 text-lg font-semibold">
                {latestReport && latestReport.level !== "unknown"
                  ? t(`releaseReport.runtimeLevels.${latestReport.level}`)
                  : "-"}
              </h2>
            </div>
            <span className="rounded-lg border bg-muted p-2 text-muted-foreground">
              <Clock3 className="size-4" />
            </span>
          </div>
          <p className="text-sm text-muted-foreground">
            {latestRelease
              ? t("versions.latestVersion", { version: latestRelease.versionNumber })
              : t("versions.empty")}
          </p>
        </section>
      </div>

      <div className="overflow-hidden rounded-lg border bg-card/92 shadow-sm">
        <div className="flex flex-col gap-3 border-b bg-muted/20 px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-semibold">{t("versions.deploymentPipeline")}</h2>
            <p className="text-xs text-muted-foreground">{t("versions.total", { count: releases.length })}</p>
          </div>
          <Button size="sm" className="min-h-10 sm:min-h-7" disabled={!canUpload} onClick={onUploadClick}>
            <Plus className="size-4" />
            {t("toast.publishVersion")}
          </Button>
        </div>

        {releases.map((release, index) => {
          const report = parseReleaseReport(release.detectResult);
          const canDeployRelease = release.status === "ready";
          const deploymentAction =
            activeRelease && release.versionNumber < activeRelease.versionNumber ? "rollback" : "publish";
          const isHighlighted = highlightedReleaseId === release.id;

          return (
            <div key={release.id}>
              <div
                className={cn(
                  "grid gap-3 px-3 py-3.5 transition-colors hover:bg-muted/45 md:grid-cols-[1fr_auto] md:items-center",
                  isHighlighted && "bg-primary/5 ring-1 ring-inset ring-primary/20 hover:bg-primary/10",
                )}
              >
                <div className="flex min-w-0 items-start gap-3">
                  <span
                    className={cn(
                      "mt-1 size-2.5 shrink-0 rounded-full ring-4",
                      release.status === "active"
                        ? "bg-primary ring-primary/10"
                        : release.status === "failed"
                          ? "bg-destructive ring-destructive/10"
                          : "bg-muted-foreground ring-muted",
                    )}
                  />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm tracking-tight">
                        v{release.versionNumber}
                        {release.releaseHash && (
                          <span className="ml-1 text-muted-foreground">({release.releaseHash})</span>
                        )}
                      </span>
                      <span
                        className={`inline-flex shrink-0 rounded-md border px-1.5 py-0.5 text-xs font-semibold uppercase leading-none tracking-[0.06em] ${releaseStatusBadgeClass(release.status)}`}
                      >
                        {releaseStatusLabel(release.status, t)}
                      </span>
                      {isHighlighted ? (
                        <Badge variant="secondary" className="rounded-md">
                          {t("versions.justUploaded")}
                        </Badge>
                      ) : null}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <span>{t("versions.files", { count: release.fileCount })}</span>
                      <span>{t("versions.size", { size: Math.round(release.totalSize / 1024) })}</span>
                      <span>
                        {report.seoScore === null
                          ? t("releaseReport.noSeoScore")
                          : t("releaseReport.seoScore", { score: report.seoScore })}
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
                    <ExternalLink className="size-4" />
                    {t("versions.preview")}
                  </Button>
                  {canDeployRelease ? (
                    <Button
                      size="sm"
                      className="min-h-10 flex-1 sm:min-h-7 sm:flex-none"
                      disabled={!canDeploy || deploymentLoading}
                      onClick={() => openDeploymentConfirm(release)}
                    >
                      <Rocket className="size-4" />
                      {deploymentAction === "rollback" ? t("versions.rollback") : t("versions.publish")}
                    </Button>
                  ) : null}
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="size-10 sm:size-7"
                    aria-label={t("releaseReport.toggle")}
                    onClick={() =>
                      setExpandedReleaseId((current) => (current === release.id ? null : release.id))
                    }
                  >
                    <BarChart3 className="size-4" />
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" className="size-10 sm:size-7" />}>
                      <MoreHorizontal className="size-4" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" sideOffset={6} className="min-w-40">
                      <DropdownMenuItem
                        disabled={!canDelete}
                        className="text-destructive"
                        onClick={() => toast.info(t("toast.deleteVersionSoon"))}
                      >
                        {t("versions.delete")}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
              {expandedReleaseId === release.id && <ProjectReleaseReport release={release} />}
              {index < releases.length - 1 && <Separator />}
            </div>
          );
        })}
      </div>

      <DeploymentConfirmDialog
        intent={deploymentIntent}
        activeRelease={activeRelease}
        loading={deploymentLoading}
        message={deploymentMessage}
        onMessageChange={setDeploymentMessage}
        onCancel={() => {
          setDeploymentIntent(null);
          setDeploymentMessage("");
        }}
        onConfirm={() => {
          void confirmDeployment();
        }}
      />
    </div>
  );
}
