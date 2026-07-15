import { ArrowRight, Clock3, FolderOpen, Globe2, Plus, RefreshCw, Rocket } from 'lucide-react';
import { useMemo } from 'react';
import { useNavigate, useOutletContext } from 'react-router';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { useTranslation } from '../i18n';
import { useProjectsStore } from '../stores';
import type { Project } from '../stores/projectsStore';

export function ProjectListPage() {
  const { t } = useTranslation();
  const { projects, loading, fetchProjects } = useProjectsStore();
  const navigate = useNavigate();
  const { setShowCreate } = useOutletContext<{ setShowCreate: (v: boolean) => void }>();

  const liveProjectsCount = projects.filter((project) => project.currentReleaseId).length;
  const draftProjectsCount = projects.length - liveProjectsCount;
  const recentProjects = useMemo(
    () =>
      [...projects]
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
        .slice(0, 4),
    [projects],
  );

  return (
    <section className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('projects.title')}</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{t('projects.subtitle')}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => void fetchProjects()} disabled={loading}>
            <RefreshCw className="size-4" />
            {t('projects.refresh')}
          </Button>
          <Button onClick={() => setShowCreate(true)}>
            <Plus className="size-4" />
            {t('app.newProject')}
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <MetricCard icon={Rocket} label={t('projects.totalProjects')} value={projects.length} />
        <MetricCard icon={Globe2} label={t('projects.liveProjects')} value={liveProjectsCount} />
        <MetricCard icon={Clock3} label={t('projects.draftProjects')} value={draftProjectsCount} />
      </div>

      {loading ? (
        <div className="rounded-lg border bg-card p-8 text-center text-sm text-muted-foreground">
          {t('common.loading')}
        </div>
      ) : projects.length === 0 ? (
        <EmptyProjects onCreate={() => setShowCreate(true)} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1fr_18rem]">
          <div className="grid gap-4 md:grid-cols-2">
            {projects.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                onOpen={() => navigate(`/app/projects/${project.id}`)}
              />
            ))}
          </div>

          <aside className="rounded-lg border bg-card p-4">
            <h2 className="text-sm font-medium">{t('projects.recentActivity')}</h2>
            <div className="mt-3 space-y-2">
              {recentProjects.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('projects.noRecentProjects')}</p>
              ) : (
                recentProjects.map((project) => (
                  <button
                    key={project.id}
                    type="button"
                    onClick={() => navigate(`/app/projects/${project.id}`)}
                    className="flex w-full items-center justify-between gap-3 rounded-md px-2 py-2 text-left text-sm hover:bg-accent"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{project.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">/{project.slug}</span>
                    </span>
                    <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
                  </button>
                ))
              )}
            </div>
          </aside>
        </div>
      )}
    </section>
  );
}

function MetricCard({ icon: Icon, label, value }: { icon: typeof Rocket; label: string; value: number }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">{label}</p>
        <Icon className="size-4 text-muted-foreground" />
      </div>
      <p className="mt-2 text-2xl font-semibold">{value}</p>
    </div>
  );
}

function ProjectCard({ project, onOpen }: { project: Project; onOpen: () => void }) {
  const { t } = useTranslation();
  const isLive = Boolean(project.currentReleaseId);

  return (
    <button
      type="button"
      onClick={onOpen}
      className="rounded-lg border bg-card p-5 text-left shadow-sm transition-colors hover:bg-accent/40"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate font-semibold">{project.name}</h2>
          <p className="mt-1 truncate font-mono text-xs text-muted-foreground">/{project.slug}</p>
        </div>
        <Badge variant={isLive ? 'default' : 'outline'}>
          {isLive ? t('projects.live') : t('projects.draft')}
        </Badge>
      </div>
      <p className="mt-4 line-clamp-2 text-sm text-muted-foreground">
        {project.description || t('projects.noDescription')}
      </p>
      <div className="mt-5 flex items-center text-sm font-medium">
        {t('projects.openProject')}
        <ArrowRight className="ml-2 size-4" />
      </div>
    </button>
  );
}

function EmptyProjects({ onCreate }: { onCreate: () => void }) {
  const { t } = useTranslation();

  return (
    <div className="rounded-lg border bg-card p-10 text-center">
      <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-muted">
        <FolderOpen className="size-5 text-muted-foreground" />
      </div>
      <h3 className="mt-4 text-lg font-semibold">{t('projects.empty')}</h3>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">{t('projects.emptyDesc')}</p>
      <Button className="mt-6" onClick={onCreate}>
        <Plus className="size-4" />
        {t('app.newProject')}
      </Button>
    </div>
  );
}
