import { ShieldAlert } from "lucide-react";
import { useEffect, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../../components/ui/alert-dialog";
import { Checkbox } from "../../components/ui/checkbox";
import { Label } from "../../components/ui/label";
import { Textarea } from "../../components/ui/textarea";
import { useTranslation } from "../../i18n";
import { cn } from "../../lib/utils";
import type { Release } from "../../stores/projectsStore";
import { parseReleaseReport, summarizeReleaseGate } from "./releaseReport";

export type DeploymentIntent = {
  action: "publish" | "rollback";
  release: Release;
};

interface DeploymentConfirmDialogProps {
  intent: DeploymentIntent | null;
  activeRelease: Release | null;
  loading: boolean;
  message: string;
  onMessageChange: (message: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}

export function DeploymentConfirmDialog({
  intent,
  activeRelease,
  loading,
  message,
  onMessageChange,
  onCancel,
  onConfirm,
}: DeploymentConfirmDialogProps) {
  const { t } = useTranslation();
  const [riskAccepted, setRiskAccepted] = useState(false);
  const report = intent ? parseReleaseReport(intent.release.detectResult) : null;
  const gate = report ? summarizeReleaseGate(report) : null;
  const requiresRiskAcceptance = intent?.action === "publish" && (gate?.failedCount ?? 0) > 0;
  const confirmDisabled = loading || (requiresRiskAcceptance && !riskAccepted);

  useEffect(() => {
    setRiskAccepted(false);
  }, [intent?.release.id, intent?.action]);

  return (
    <AlertDialog
      open={intent !== null}
      onOpenChange={(open) => {
        if (!open && !loading) onCancel();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {intent?.action === "rollback"
              ? t("versions.confirmRollbackTitle")
              : t("versions.confirmPublishTitle")}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {intent?.action === "rollback"
              ? t("versions.confirmRollbackDesc")
              : t("versions.confirmPublishDesc")}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="grid gap-2 rounded-lg border bg-muted/35 p-3 text-sm">
          <div className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground">{t("versions.currentRelease")}</span>
            <span className="truncate font-mono text-xs">{formatRelease(activeRelease, t("versions.noLiveRelease"))}</span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground">{t("versions.targetRelease")}</span>
            <span className="truncate font-mono text-xs">
              {formatRelease(intent?.release ?? null, t("versions.noLiveRelease"))}
            </span>
          </div>
        </div>

        {gate ? (
          <div
            className={cn(
              "grid gap-3 rounded-lg border p-3 text-sm",
              gate.level === "failed"
                ? "border-destructive/30 bg-destructive/10"
                : gate.level === "warning"
                  ? "border-amber-500/30 bg-amber-500/10"
                  : "bg-muted/25",
            )}
          >
            <div className="flex items-start gap-2">
              <ShieldAlert
                className={cn(
                  "mt-0.5 size-4 shrink-0",
                  gate.level === "failed"
                    ? "text-destructive"
                    : gate.level === "warning"
                      ? "text-amber-600"
                      : "text-muted-foreground",
                )}
              />
              <div className="min-w-0">
                <div className="font-medium">{t("versions.qualityGateTitle")}</div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {gate.failedCount > 0
                    ? t("versions.qualityGateFailedDesc", { count: gate.failedCount })
                    : gate.warningCount > 0
                      ? t("versions.qualityGateWarningDesc", { count: gate.warningCount })
                      : t("versions.qualityGatePassedDesc")}
                </p>
              </div>
            </div>

            <div className="grid gap-2 sm:grid-cols-3">
              <QualityMetric
                label={t("versions.qualitySeo")}
                value={gate.seoScore === null ? t("releaseReport.noSeoScore") : t("releaseReport.seoScore", { score: gate.seoScore })}
              />
              <QualityMetric
                label={t("versions.qualityRuntime")}
                value={
                  gate.runtimeLevel === "unknown"
                    ? t("releaseReport.unknown")
                    : t(`releaseReport.runtimeLevels.${gate.runtimeLevel}`)
                }
              />
              <QualityMetric
                label={t("versions.qualityIssues")}
                value={t("versions.qualityIssueCounts", {
                  failed: gate.failedCount,
                  warnings: gate.warningCount,
                })}
              />
            </div>

            {gate.topIssues.length > 0 ? (
              <div className="space-y-1">
                {gate.topIssues.map((issue) => (
                  <div
                    key={`${issue.level}-${issue.code}`}
                    className="flex min-w-0 items-center justify-between gap-3 rounded-md bg-background/60 px-2 py-1.5 text-xs"
                  >
                    <span className="min-w-0 truncate">{t(`releaseReport.codes.${issue.code}`)}</span>
                    <span
                      className={cn(
                        "shrink-0 rounded-md border px-1.5 py-0.5 uppercase",
                        issue.level === "failed"
                          ? "border-destructive/30 text-destructive"
                          : "border-amber-500/30 text-amber-700",
                      )}
                    >
                      {issue.level === "failed"
                        ? t("releaseReport.runtimeLevels.failed")
                        : t("releaseReport.runtimeLevels.warning")}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        {requiresRiskAcceptance ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3">
            <Label className="items-start gap-3 text-sm leading-5">
              <Checkbox
                checked={riskAccepted}
                onCheckedChange={(checked) => setRiskAccepted(checked === true)}
                disabled={loading}
                aria-label={t("versions.riskAcceptanceLabel")}
                className="mt-0.5"
              />
              <span>
                <span className="block font-medium text-destructive">
                  {t("versions.riskAcceptanceTitle")}
                </span>
                <span className="mt-1 block text-xs font-normal text-muted-foreground">
                  {t("versions.riskAcceptanceDesc", { count: gate?.failedCount ?? 0 })}
                </span>
              </span>
            </Label>
          </div>
        ) : null}

        <label className="grid gap-1.5 text-sm font-medium">
          {t("versions.deploymentMessage")}
          <Textarea
            value={message}
            onChange={(event) => onMessageChange(event.target.value)}
            maxLength={240}
            rows={3}
            className="field-sizing-fixed text-sm"
            placeholder={
              intent?.action === "rollback"
                ? t("versions.rollbackMessagePlaceholder")
                : t("versions.publishMessagePlaceholder")
            }
            disabled={loading}
          />
          <span className="text-xs font-normal text-muted-foreground">
            {t("versions.deploymentMessageHint", { count: message.trim().length })}
          </span>
        </label>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={loading}>{t("common.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            disabled={confirmDisabled}
            onClick={(event) => {
              event.preventDefault();
              if (confirmDisabled) return;
              onConfirm();
            }}
          >
            {intent?.action === "rollback" ? t("versions.confirmRollback") : t("versions.confirmPublish")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function formatRelease(release: Release | null, fallback: string) {
  return release ? `v${release.versionNumber} (${release.releaseHash})` : fallback;
}

function QualityMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-md border bg-background/55 px-2 py-1.5">
      <div className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground">{label}</div>
      <div className="mt-0.5 truncate font-medium">{value}</div>
    </div>
  );
}
