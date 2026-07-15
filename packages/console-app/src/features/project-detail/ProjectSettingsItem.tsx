import type { LucideIcon } from 'lucide-react';

export function ProjectPathLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg border bg-muted/25 p-3">
      <div className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
        {label}
      </div>
      <code className="mt-1 block truncate font-mono text-xs">{value}</code>
    </div>
  );
}

export function ProjectPolicyItem({
  icon: Icon,
  title,
  description,
  value,
}: {
  icon: LucideIcon;
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
