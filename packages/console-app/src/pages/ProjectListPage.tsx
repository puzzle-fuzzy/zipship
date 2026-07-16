import { useNavigate, useOutletContext } from 'react-router';
import { MaterialIcon } from '../components/MaterialIcon';
import { Button } from '../components/primitives/button';
import { Skeleton } from '../components/primitives/skeleton';
import { useTranslation } from '../i18n';
import { useProjectsStore } from '../stores';
import type { Project } from '../stores/projectsStore';

export function ProjectListPage() {
  const { t } = useTranslation();
  const { projects, loading, fetchProjects } = useProjectsStore();
  const navigate = useNavigate();
  const { setShowCreate } = useOutletContext<{ setShowCreate: (value: boolean) => void }>();
  const liveProjects = projects.filter((project) => project.currentReleaseId).length;

  return (
    <section className="py-8 sm:py-12">
      <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-medium tracking-[-0.025em] text-balance">{t('projects.title')}</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground text-pretty">
            {t('projects.subtitle')}
          </p>
          {!loading || projects.length > 0 ? (
            <p className="mt-3 text-xs text-muted-foreground">
              {t('projects.summary', { count: projects.length, live: liveProjects })}
            </p>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Button
            aria-label={t('projects.refresh')}
            title={t('projects.refresh')}
            variant="outline"
            size="icon-lg"
            className="size-11"
            disabled={loading}
            onClick={() => void fetchProjects()}
          >
            <MaterialIcon name="refresh" className={loading ? 'animate-spin' : undefined} />
          </Button>
          <Button className="h-11 gap-2 px-5" onClick={() => setShowCreate(true)}>
            <MaterialIcon name="add" className="text-[19px]" />
            {t('app.newProject')}
          </Button>
        </div>
      </div>

      <div className="mt-8">
        {loading && projects.length === 0 ? (
          <ProjectListSkeleton label={t('common.loading')} />
        ) : projects.length === 0 ? (
          <EmptyProjects onCreate={() => setShowCreate(true)} />
        ) : (
          <div className="overflow-hidden rounded-xl border bg-card" aria-busy={loading}>
            <div className="flex items-center justify-between gap-4 border-b px-4 py-3 sm:px-5">
              <h2 className="text-sm font-medium">{t('projects.allProjects')}</h2>
              <span className="text-xs text-muted-foreground">
                {t('projects.projectCount', { count: projects.length })}
              </span>
            </div>
            <ul aria-label={t('projects.allProjects')}>
              {projects.map((project) => (
                <li key={project.id} className="border-b last:border-b-0">
                  <ProjectRow
                    project={project}
                    onOpen={() => navigate(`/app/projects/${project.id}`)}
                  />
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}

function ProjectRow({ project, onOpen }: { project: Project; onOpen: () => void }) {
  const { t, language } = useTranslation();
  const isLive = Boolean(project.currentReleaseId);
  const updatedAt = new Intl.DateTimeFormat(language === 'zh' ? 'zh-CN' : 'en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(new Date(project.updatedAt));

  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex min-h-24 w-full items-center gap-3 px-4 py-4 text-left outline-none transition-colors duration-200 hover:bg-accent focus-visible:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:gap-4 sm:px-5"
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground transition-colors duration-200 group-hover:bg-primary group-hover:text-primary-foreground">
        <MaterialIcon name="folder_open" className="text-[20px]" />
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-foreground">{project.name}</span>
          <ProjectStatus live={isLive} className="sm:hidden" />
        </span>
        <span className="mt-1 block truncate font-mono text-xs text-muted-foreground">
          /{project.slug}
        </span>
        <span className="mt-1 block truncate text-xs text-muted-foreground sm:max-w-xl">
          {project.description || t('projects.noDescription')}
        </span>
      </span>

      <span className="hidden shrink-0 flex-col items-end gap-1.5 sm:flex">
        <ProjectStatus live={isLive} />
        <span className="text-xs text-muted-foreground">{t('projects.updated', { date: updatedAt })}</span>
      </span>

      <MaterialIcon
        name="arrow_forward"
        className="text-[18px] text-muted-foreground transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-foreground"
      />
    </button>
  );
}

function ProjectStatus({ live, className = '' }: { live: boolean; className?: string }) {
  const { t } = useTranslation();
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 text-xs ${live ? 'text-success' : 'text-muted-foreground'} ${className}`}
    >
      <span className={`size-1.5 rounded-full ${live ? 'bg-success' : 'bg-muted-foreground/50'}`} />
      {live ? t('projects.live') : t('projects.draft')}
    </span>
  );
}

function ProjectListSkeleton({ label }: { label: string }) {
  return (
    <div className="overflow-hidden rounded-xl border bg-card" role="status" aria-label={label}>
      <span className="sr-only">{label}</span>
      {Array.from({ length: 3 }, (_, index) => (
        <div key={index} className="flex min-h-24 items-center gap-4 border-b px-4 py-4 last:border-b-0 sm:px-5">
          <Skeleton className="size-10 shrink-0 rounded-lg" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-3.5 w-36" />
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-3 w-2/3" />
          </div>
          <Skeleton className="hidden h-3 w-20 sm:block" />
        </div>
      ))}
    </div>
  );
}

function EmptyProjects({ onCreate }: { onCreate: () => void }) {
  const { t } = useTranslation();

  return (
    <div className="flex min-h-80 flex-col items-center justify-center rounded-xl border border-dashed bg-card/40 px-6 py-12 text-center">
      <MaterialIcon name="deployed_code" className="text-[32px] text-primary" />
      <h2 className="mt-5 text-base font-medium">{t('projects.empty')}</h2>
      <p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">{t('projects.emptyDesc')}</p>
      <Button className="mt-6 h-11 gap-2 px-5" onClick={onCreate}>
        <MaterialIcon name="add" className="text-[19px]" />
        {t('app.newProject')}
      </Button>
    </div>
  );
}
