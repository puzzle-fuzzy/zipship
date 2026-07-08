/**
 * Pure helpers mapping a release status to a translated label and a Tailwind
 * badge class. Extracted from ProjectDetailPage so the Versions tab (and any
 * future surface) share one definition, and so the mapping is unit-testable.
 */

/** Translate a release status, falling back to the raw status when unknown. */
export function releaseStatusLabel(
  status: string,
  t: (key: string) => string,
): string {
  const map: Record<string, string> = {
    active: t("versions.status.active"),
    ready: t("versions.status.ready"),
    uploading: t("versions.status.uploading"),
    processing: t("versions.status.processing"),
    failed: t("versions.status.failed"),
    archived: t("versions.status.archived"),
    deleted: t("versions.status.deleted"),
  };
  return map[status] ?? status;
}

/** Tailwind classes for the status badge, keyed by status. */
export function releaseStatusBadgeClass(status: string): string {
  switch (status) {
    case "active":
      return "border-primary/20 bg-primary/10 text-primary";
    case "ready":
      return "border-border bg-muted text-muted-foreground";
    case "failed":
      return "border-destructive/30 bg-destructive/10 text-destructive";
    case "archived":
    case "deleted":
      return "border-border bg-background text-muted-foreground";
    default:
      return "border-border bg-background text-muted-foreground";
  }
}
