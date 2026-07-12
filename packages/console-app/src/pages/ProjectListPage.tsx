import {
  ArrowRight,
  Box,
  Clock3,
  FolderOpen,
  Globe2,
  Plus,
  RefreshCw,
  Rocket,
  Search,
  UploadCloud,
} from 'lucide-react';
import { useMemo } from 'react';
import { useNavigate, useOutletContext } from 'react-router';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { useTranslation } from '../i18n';
import type { Project } from '../stores/projectsStore';
import { useAuthStore, useProjectsStore } from '../stores';

export function ProjectListPage() {
  const { t } = useTranslation();
  const { user, refreshToken } = useAuthStore();
  const { projects, loading, fetchProjects } = useProjectsStore();
  const navigate = useNavigate();
  const { setShowCreate } = useOutletContext<{ setShowCreate: (v: boolean) => void }>();

  const liveProjectsCount = projects.filter((project) => project.currentReleaseId).length;
  const draftProjectsCount = projects.length - liveProjectsCount;
  const visibleProjects = projects.slice(0, 10);
  const recentProjects = useMemo(
    () =>
      [...projects]
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
        .slice(0, 4),
    [projects],
  );

  return (
    <section className="relative min-h-[calc(100dvh-3.5rem)] pl-12 pr-[18rem]">
      <CanvasEdges count={visibleProjects.length} />

      <div className="absolute left-1/2 top-[19%] z-10 w-52 -translate-x-1/2">
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          className="zip-node zip-node-pink block w-full p-4 text-left"
        >
          <div className="mb-2 inline-flex rounded-full border-2 border-foreground bg-background px-2 py-0.5 text-[0.62rem] font-black uppercase">
            Control Plane
          </div>
          <h1 className="text-lg font-black leading-tight">{t('projects.title')}</h1>
          <p className="mt-2 text-xs font-semibold leading-5">
            {t('projects.subtitle')}
          </p>
        </button>
      </div>

      {loading ? (
        <div className="absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2">
          <div className="zip-node w-60 p-5 text-center text-sm font-black">{t('common.loading')}</div>
        </div>
      ) : visibleProjects.length === 0 ? (
        <div className="absolute left-1/2 top-1/2 z-10 w-80 -translate-x-1/2 -translate-y-1/2">
          <EmptyProjects onCreate={() => setShowCreate(true)} />
        </div>
      ) : (
        visibleProjects.map((project, index) => (
          <ProjectNode
            key={project.id}
            project={project}
            index={index}
            onOpen={() => navigate(`/app/projects/${project.id}`)}
          />
        ))
      )}

      <aside className="zip-right-panel">
        <div className="mb-2 flex items-center gap-2">
          <span className="grid size-8 place-items-center rounded border-2 border-foreground bg-background">
            <Search className="size-4" />
          </span>
          <Input className="h-8 border-2 text-sm font-bold" placeholder={t('app.search')} disabled />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <ToolbarButton label={t('projects.refresh')} onClick={() => refreshToken && fetchProjects()} />
          <ToolbarButton label={t('app.newProject')} onClick={() => setShowCreate(true)} highlight />
          <ToolbarButton label={t('projects.liveProjects')} />
          <ToolbarButton label={t('projects.draftProjects')} />
          <ToolbarButton label={t('versions.upload')} />
          <ToolbarButton label={t('versions.publish')} />
          <ToolbarButton label={t('versions.rollback')} />
          <ToolbarButton label={t('releaseReport.runtime')} />
        </div>

        <div className="mt-3 rounded-md border-[3px] border-foreground bg-background p-3">
          <div className="mb-2 text-xs font-black uppercase">{user?.email ?? t('projects.workspace')}</div>
          <MetricLine icon={Rocket} label={t('projects.totalProjects')} value={projects.length} />
          <MetricLine icon={Globe2} label={t('projects.liveProjects')} value={liveProjectsCount} />
          <MetricLine icon={Clock3} label={t('projects.draftProjects')} value={draftProjectsCount} />
        </div>

        <div className="mt-3 rounded-md border-[3px] border-foreground bg-background p-3">
          <div className="mb-2 text-xs font-black uppercase">{t('projects.recentActivity')}</div>
          <div className="flex flex-col gap-2">
            {recentProjects.length === 0 ? (
              <span className="text-xs font-semibold text-muted-foreground">{t('projects.noRecentProjects')}</span>
            ) : (
              recentProjects.map((project) => (
                <button
                  key={project.id}
                  type="button"
                  onClick={() => navigate(`/app/projects/${project.id}`)}
                  className="flex items-center justify-between rounded border-2 border-foreground px-2 py-1 text-left text-xs font-black hover:bg-muted"
                >
                  <span className="truncate">{project.slug}</span>
                  <ArrowRight className="size-3" />
                </button>
              ))
            )}
          </div>
        </div>

        <Button className="mt-3 w-full bg-sky-400 text-foreground hover:bg-sky-300" onClick={() => setShowCreate(true)}>
          <UploadCloud className="size-4" />
          {t('projects.createCtaTitle')}
        </Button>
      </aside>
    </section>
  );
}

function ProjectNode({ project, index, onOpen }: { project: Project; index: number; onOpen: () => void }) {
  const { t } = useTranslation();
  const isLive = Boolean(project.currentReleaseId);
  const position = nodePositions[index % nodePositions.length];

  return (
    <button
      type="button"
      onClick={onOpen}
      className={`zip-node absolute z-10 w-64 p-3 text-left transition-transform hover:-translate-y-1 ${position.className} ${
        isLive ? 'zip-node-blue' : ''
      }`}
      style={{ left: position.left, top: position.top }}
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <span className="inline-flex rounded-full border-2 border-foreground bg-background px-2 py-0.5 text-[0.62rem] font-black uppercase">
          {isLive ? t('projects.live') : t('projects.draft')}
        </span>
        <Box className="size-4 shrink-0" />
      </div>
      <h2 className="truncate text-sm font-black">{project.name}</h2>
      <p className="mt-1 truncate font-mono text-xs font-bold">/{project.slug}</p>
      <p className="mt-3 line-clamp-4 text-xs font-semibold leading-5 text-foreground/75">
        {project.description || t('projects.noDescription')}
      </p>
      <div className="mt-3 flex items-center justify-between border-t-2 border-foreground/25 pt-2">
        <Badge variant={isLive ? 'default' : 'outline'}>{isLive ? t('versions.status.active') : t('versions.status.ready')}</Badge>
        <span className="inline-flex items-center gap-1 text-xs font-black">
          {t('projects.openProject')}
          <ArrowRight className="size-3" />
        </span>
      </div>
    </button>
  );
}

const nodePositions = [
  { left: '9%', top: '9%', className: '' },
  { left: '31%', top: '47%', className: 'zip-node-pink' },
  { left: '58%', top: '13%', className: '' },
  { left: '66%', top: '54%', className: '' },
  { left: '12%', top: '58%', className: '' },
  { left: '42%', top: '73%', className: 'zip-node-orange' },
  { left: '6%', top: '34%', className: '' },
  { left: '50%', top: '36%', className: '' },
  { left: '24%', top: '20%', className: '' },
  { left: '72%', top: '30%', className: 'zip-node-blue' },
];

function CanvasEdges({ count }: { count: number }) {
  const edges = nodePositions.slice(0, Math.max(count, 6)).map((position, index) => ({
    key: `${position.left}-${position.top}`,
    left: '50%',
    top: '30%',
    width: edgeWidths[index % edgeWidths.length],
    rotate: edgeAngles[index % edgeAngles.length],
  }));

  return (
    <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
      {edges.map((edge) => (
        <span
          key={edge.key}
          className="zip-edge"
          style={{
            left: edge.left,
            top: edge.top,
            width: edge.width,
            transform: `rotate(${edge.rotate}deg)`,
          }}
        />
      ))}
    </div>
  );
}

const edgeWidths = ['620px', '310px', '460px', '530px', '480px', '360px'];
const edgeAngles = [-154, 110, -28, 36, 168, 78];

function ToolbarButton({ label, onClick, highlight = false }: { label: string; onClick?: () => void; highlight?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`min-h-8 rounded-md border-[3px] border-foreground px-2 text-sm font-black transition-colors hover:bg-muted ${
        highlight ? 'bg-accent' : 'bg-background'
      }`}
    >
      {label}
    </button>
  );
}

function MetricLine({ icon: Icon, label, value }: { icon: typeof Rocket; label: string; value: number }) {
  return (
    <div className="flex items-center justify-between gap-2 border-t-2 border-foreground/15 py-2 text-xs font-black">
      <span className="inline-flex items-center gap-2">
        <Icon className="size-3.5" />
        {label}
      </span>
      <span>{value}</span>
    </div>
  );
}

function EmptyProjects({ onCreate }: { onCreate: () => void }) {
  const { t } = useTranslation();

  return (
    <div className="zip-node bg-background p-5 text-center">
      <div className="mx-auto grid size-11 place-items-center rounded-md border-[3px] border-foreground bg-muted">
        <FolderOpen className="size-5" />
      </div>
      <h3 className="mt-3 text-base font-black">{t('projects.empty')}</h3>
      <p className="mx-auto mt-2 max-w-md text-xs font-semibold text-muted-foreground">{t('projects.emptyDesc')}</p>
      <Button className="mt-4" onClick={onCreate}>
        <Plus className="size-4" />
        {t('app.newProject')}
      </Button>
    </div>
  );
}
