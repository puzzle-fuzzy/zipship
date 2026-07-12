import { FileArchive, History, RotateCcw, Rocket, ShieldCheck } from "lucide-react";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { useTranslation } from "../../i18n";
import { cn } from "../../lib/utils";
import type { Deployment, Release } from "../../stores/projectsStore";
import { buildDeploymentReleaseSnapshot } from "./deploymentSnapshot";

interface ProjectDeploymentsTabProps {
  deployments: Deployment[];
  releases: Release[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}

export function ProjectDeploymentsTab({
  deployments,
  releases,
  loading,
  error,
  onRetry,
}: ProjectDeploymentsTabProps) {
  const { t } = useTranslation();
  const releasesById = new Map(releases.map((release) => [release.id, release]));

  if (loading) {
    return (
      <div className="rounded-lg border bg-card/92 p-8 text-center text-sm text-muted-foreground">
        {t("common.loading")}
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-lg border bg-card/92 p-8 text-center text-sm text-muted-foreground">
        <span className="text-destructive">{error}</span>
        <Button variant="outline" size="sm" onClick={onRetry}>
          {t("common.retry")}
        </Button>
      </div>
    );
  }

  if (deployments.length === 0) {
    return (
      <div className="rounded-lg border border-dashed bg-card/70 p-8 text-center text-sm text-muted-foreground">
        <div className="font-medium text-foreground">{t("deployments.empty")}</div>
        <p className="mt-1">{t("deployments.emptyDesc")}</p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border bg-card/92 shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b bg-muted/20 px-4 py-3">
        <div>
          <h2 className="font-semibold">{t("deployments.title")}</h2>
          <p className="text-xs text-muted-foreground">{t("deployments.total", { count: deployments.length })}</p>
        </div>
        <History className="size-4 text-muted-foreground" />
      </div>

      <div className="divide-y">
        {deployments.map((deployment) => {
          const release = releasesById.get(deployment.releaseId);
          const previousRelease = deployment.previousReleaseId
            ? releasesById.get(deployment.previousReleaseId)
            : null;
          const isRollback = deployment.action === "rollback";
          const snapshot = buildDeploymentReleaseSnapshot(release);
          const qualityLabel =
            snapshot.qualityLevel === "unknown"
              ? t("releaseReport.unknown")
              : t(`releaseReport.runtimeLevels.${snapshot.qualityLevel}`);

          return (
            <article key={deployment.id} className="grid gap-3 px-4 py-3.5 md:grid-cols-[1fr_auto] md:items-center">
              <div className="flex min-w-0 items-start gap-3">
                <span
                  className={`mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg border ${
                    isRollback ? "bg-amber-500/10 text-amber-700" : "bg-primary/10 text-primary"
                  }`}
                >
                  {isRollback ? <RotateCcw className="size-4" /> : <Rocket className="size-4" />}
                </span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-medium">
                      {isRollback ? t("deployments.rollback") : t("deployments.publish")}
                    </h3>
                    <span className="rounded-md border bg-background px-1.5 py-0.5 text-xs text-muted-foreground">
                      {t("deployments.success")}
                    </span>
                    <Badge
                      variant="outline"
                      className={cn(
                        "rounded-md",
                        snapshot.qualityLevel === "failed"
                          ? "border-destructive/30 text-destructive"
                          : snapshot.qualityLevel === "warning"
                            ? "border-amber-500/30 text-amber-700"
                            : "text-muted-foreground",
                      )}
                    >
                      {qualityLabel}
                    </Badge>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {t("deployments.target", { version: release ? `v${release.versionNumber}` : deployment.releaseId.slice(0, 8) })}
                    {previousRelease
                      ? ` / ${t("deployments.previous", { version: `v${previousRelease.versionNumber}` })}`
                      : ""}
                  </p>
                  <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
                    <span className="font-mono">{release?.releaseHash ?? deployment.releaseId.slice(0, 8)}</span>
                    <span>{t("deployments.operator", { id: deployment.operatorId.slice(0, 8) })}</span>
                  </div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-3">
                    <DeploymentMetric
                      icon={ShieldCheck}
                      label={t("deployments.quality")}
                      value={qualityLabel}
                    />
                    <DeploymentMetric
                      icon={Rocket}
                      label={t("deployments.runtime")}
                      value={
                        snapshot.runtimeLevel !== "unknown"
                          ? t(`releaseReport.runtimeLevels.${snapshot.runtimeLevel}`)
                          : t("releaseReport.unknown")
                      }
                    />
                    <DeploymentMetric
                      icon={FileArchive}
                      label={t("deployments.artifact")}
                      value={snapshot.fileCount === null ? "-" : t("versions.files", { count: snapshot.fileCount })}
                    />
                  </div>
                  {deployment.message ? (
                    <div className="mt-3 rounded-md border bg-muted/25 px-2 py-1.5 text-sm text-muted-foreground">
                      <div className="mb-0.5 text-xs font-medium uppercase tracking-[0.08em]">
                        {t("deployments.message")}
                      </div>
                      <p>{deployment.message}</p>
                    </div>
                  ) : null}
                </div>
              </div>

              <time className="text-xs text-muted-foreground md:text-right">
                {new Date(deployment.createdAt).toLocaleString()}
              </time>
            </article>
          );
        })}
      </div>
    </div>
  );
}

function DeploymentMetric({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof ShieldCheck;
  label: string;
  value: string;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-lg border bg-background/55 px-2 py-1.5">
      <Icon className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0">
        <span className="block text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
          {label}
        </span>
        <span className="block truncate text-xs font-medium">{value}</span>
      </span>
    </div>
  );
}
