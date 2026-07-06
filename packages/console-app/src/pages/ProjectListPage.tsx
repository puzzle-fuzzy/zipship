import { Box, FolderOpen, Plus, RefreshCw } from 'lucide-react';
import { useNavigate, useOutletContext } from 'react-router';
import { useAuthStore, useProjectsStore } from '../stores';
import { useTranslation } from '../i18n';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../components/ui/card';

export function ProjectListPage() {
  const { t } = useTranslation();
  const { user, refreshToken } = useAuthStore();
  const { projects, loading, fetchProjects } = useProjectsStore();
  const navigate = useNavigate();
  const { setShowCreate } = useOutletContext<{ setShowCreate: (v: boolean) => void }>();

  const apiBaseUrl =
    (typeof window !== 'undefined' && (window as any).__ZIPSHIP_API_BASE_URL) ?? 'http://localhost:3001';

  const liveProjectsCount = projects.filter((p) => p.currentReleaseId).length;

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('projects.title')}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {projects.length} {t('app.projects')} / {liveProjectsCount} {t('projects.live')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => refreshToken && fetchProjects(apiBaseUrl, refreshToken)}>
            <RefreshCw className="size-4" />
          </Button>
          <Button size="sm" onClick={() => setShowCreate(true)}>
            <Plus className="size-4" />
            {t('app.newProject')}
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_280px]">
        {/* Project List */}
        <div>
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
            </div>
          ) : projects.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-4 py-16 text-center">
              <div className="flex size-12 items-center justify-center rounded-lg bg-muted">
                <FolderOpen className="size-6 text-muted-foreground" />
              </div>
              <div>
                <h3 className="text-lg font-medium">{t('projects.empty')}</h3>
                <p className="text-sm text-muted-foreground mt-1">{t('projects.emptyDesc')}</p>
              </div>
              <Button onClick={() => setShowCreate(true)}>
                <Plus className="size-4" />
                {t('app.newProject')}
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {projects.map((project) => (
                <button
                  key={project.id}
                  type="button"
                  onClick={() => navigate(`/app/projects/${project.id}`)}
                  className="group/card flex flex-col gap-3 overflow-hidden rounded-xl bg-card p-4 text-left text-sm text-card-foreground ring-1 ring-foreground/10 transition-all hover:shadow-md hover:ring-foreground/20"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="flex size-8 items-center justify-center rounded-lg bg-muted text-foreground">
                        <Box className="size-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="font-medium truncate">{project.name}</div>
                        <div className="text-xs text-muted-foreground truncate">/{project.slug}</div>
                      </div>
                    </div>
                    <Badge variant={project.currentReleaseId ? 'default' : 'outline'}>
                      {project.currentReleaseId ? t('projects.live') : t('projects.draft')}
                    </Badge>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Workspace Card */}
        <div>
          <Card>
            <CardHeader>
              <CardTitle>Workspace</CardTitle>
              <CardDescription>{user?.email}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{t('app.projects')}</span>
                <span className="font-medium">{projects.length}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{t('projects.live')}</span>
                <span className="font-medium">{liveProjectsCount}</span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
