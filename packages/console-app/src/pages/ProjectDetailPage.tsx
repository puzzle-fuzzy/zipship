import { Code2, MoreHorizontal, Plus, Settings, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { useAuthStore, useProjectsStore } from '../stores';
import { useTranslation } from '../i18n';
import { Avatar, AvatarFallback } from '../components/ui/avatar';
import { Button } from '../components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../components/ui/card';
import { Checkbox } from '../components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu';
import { Input } from '../components/ui/input';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { Separator } from '../components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Textarea } from '../components/ui/textarea';
import { UploadVersionDialog } from '../features/versions/UploadVersionDialog';

export function ProjectDetailPage() {
  const { t } = useTranslation();
  const { projectId } = useParams();
  const { refreshToken } = useAuthStore();
  const { projects, releases, fetchReleases } = useProjectsStore();
  const [showUpload, setShowUpload] = useState(false);

  const apiBaseUrl =
    (typeof window !== 'undefined' && (window as any).__ZIPSHIP_API_BASE_URL) ?? 'http://localhost:3001';

  const project = projects.find((p) => p.id === projectId) ?? null;
  const projectReleases = projectId ? releases[projectId] ?? [] : [];
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (projectId && refreshToken) {
      fetchReleases(apiBaseUrl, refreshToken, projectId).finally(() => setLoading(false));
    }
  }, [projectId, refreshToken]);

  if (!project) {
    return (
      <div className="flex items-center justify-center py-16">
        <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
      </div>
    );
  }

  const activeRelease = projectReleases.find((r) => r.status === 'active');

  const statusLabel = (status: string) => {
    const map: Record<string, string> = {
      active: t('versions.status.active'),
      ready: t('versions.status.ready'),
      uploading: t('versions.status.uploading'),
      processing: t('versions.status.processing'),
      failed: t('versions.status.failed'),
    };
    return map[status] ?? status;
  };

  const statusBadgeClass = (status: string) => {
    switch (status) {
      case 'active':
        return 'border-primary/20 bg-primary/10 text-primary';
      case 'ready':
        return 'border-border bg-muted text-muted-foreground';
      case 'failed':
        return 'border-destructive/30 bg-destructive/10 text-destructive';
      default:
        return 'border-border bg-background text-muted-foreground';
    }
  };

  return (
    <section className="flex flex-col gap-4 py-6">
      {/* ─── Project Header ─── */}
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{project.name}</h1>
          <p className="text-sm text-muted-foreground">/{project.slug}</p>
        </div>
        <Button onClick={() => setShowUpload(true)}>
          <Plus className="size-4" />
          {t('versions.upload')}
        </Button>
      </div>

      {/* ─── Tabs (line variant, with icons) ─── */}
      <Tabs defaultValue="versions">
        <TabsList variant="line">
          <TabsTrigger value="versions">
            <Code2 className="size-4" />
            {t('versions.title')}
          </TabsTrigger>
          <TabsTrigger value="members">
            <Users className="size-4" />
            {t('members.title')}
          </TabsTrigger>
          <TabsTrigger value="settings">
            <Settings className="size-4" />
            {t('settings.title')}
          </TabsTrigger>
        </TabsList>

        {/* ────── Versions Tab ────── */}
        <TabsContent value="versions" className="pt-3">
          {loading ? (
            <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
              {t('common.loading')}
            </div>
          ) : projectReleases.length === 0 ? (
            <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
              {t('versions.empty')}
            </div>
          ) : (
            <div className="rounded-xl border bg-card">
              {projectReleases.map((release, index) => (
                <div key={release.id}>
                  <div className="flex w-full items-center justify-between gap-4 px-3 py-3.5">
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      <span className="shrink-0 text-xs font-medium text-muted-foreground">Ver.</span>
                      <span className="truncate font-mono text-xs tracking-tight">
                        v{release.versionNumber}
                        {release.releaseHash && (
                          <span className="text-muted-foreground ml-1">({release.releaseHash})</span>
                        )}
                      </span>
                      <span
                        className={`inline-flex shrink-0 rounded-md border px-1.5 py-0.5 text-[10px] font-medium leading-none ${statusBadgeClass(release.status)}`}
                      >
                        {statusLabel(release.status)}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span>{t('versions.files', { count: release.fileCount })}</span>
                      <span>·</span>
                      <span>{t('versions.size', { size: Math.round(release.totalSize / 1024) })}</span>
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={<Button variant="ghost" size="icon-sm" />}
                        >
                          <MoreHorizontal className="size-4" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" sideOffset={6} className="min-w-40">
                          <DropdownMenuItem disabled>
                            {t('versions.status.preview') || '预览'}
                          </DropdownMenuItem>
                          {release.status !== 'active' && (
                            <DropdownMenuItem disabled>
                              发布
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem disabled className="text-destructive">
                            删除
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                  {index < projectReleases.length - 1 && <Separator />}
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ────── Members Tab ────── */}
        <TabsContent value="members" className="pt-3">
          <Card>
            <CardHeader>
              <CardTitle>{t('members.title')}</CardTitle>
              <CardDescription>{t('members.title')}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {[1, 2, 3].map((i) => {
                const roles: Record<number, string> = { 1: 'owner', 2: 'admin', 3: 'developer' };
                const role = roles[i] ?? 'viewer';
                return (
                  <div
                    key={i}
                    className="flex items-center justify-between gap-3 rounded-xl border bg-card p-3"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <Avatar size="sm">
                        <AvatarFallback>U{i}</AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">User {i}</div>
                        <div className="text-xs text-muted-foreground">user{i}@example.com</div>
                      </div>
                    </div>
                    <span className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs">
                      {t(`members.${role}`)}
                    </span>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ────── Settings Tab ────── */}
        <TabsContent value="settings" className="pt-3">
          <Card>
            <CardHeader>
              <CardTitle>{t('settings.title')}</CardTitle>
              <CardDescription>{t('settings.title')}</CardDescription>
            </CardHeader>
            <CardContent>
              <form className="flex flex-col gap-4" onSubmit={(e) => e.preventDefault()}>
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="flex flex-col gap-1.5 text-sm font-medium">
                    {t('projects.name')}
                    <Input defaultValue={project.name} disabled />
                  </label>
                  <label className="flex flex-col gap-1.5 text-sm font-medium">
                    {t('projects.slug')}
                    <Input defaultValue={project.slug} className="font-mono" disabled />
                  </label>
                </div>

                <label className="flex flex-col gap-1.5 text-sm font-medium">
                  {t('projects.description')}
                  <Textarea
                    defaultValue={project.description ?? ''}
                    placeholder={t('projects.descriptionPlaceholder')}
                    className="field-sizing-fixed"
                    rows={4}
                    disabled
                  />
                </label>

                <div className="grid gap-3 md:grid-cols-2">
                  <label className="flex items-center gap-2 text-sm font-medium">
                    <Checkbox defaultChecked={false} disabled />
                    SPA 模式
                  </label>
                  <label className="flex flex-col gap-1.5 text-sm font-medium">
                    路由方式
                    <Select defaultValue="path" disabled>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectItem value="path">Path (/about)</SelectItem>
                          <SelectItem value="hash">Hash (#/about)</SelectItem>
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </label>
                </div>

                <div className="flex flex-col gap-1.5">
                  <span className="text-sm font-medium">{t('settings.deployUrl')}</span>
                  {activeRelease ? (
                    <code className="w-fit rounded-md bg-muted px-2 py-1 font-mono text-xs">
                      /{project.slug}/{activeRelease.releaseHash}/
                    </code>
                  ) : (
                    <span className="text-sm text-muted-foreground">{t('settings.noDeployed')}</span>
                  )}
                </div>

                <div className="flex items-center justify-between gap-2 pt-2">
                  <Button type="button" variant="destructive" disabled>
                    删除项目
                  </Button>
                  <Button type="submit" disabled>
                    保存
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <UploadVersionDialog
        open={showUpload}
        onClose={() => setShowUpload(false)}
        projectId={project.id}
        refreshToken={refreshToken!}
        apiBaseUrl={apiBaseUrl}
        onUploaded={() => fetchReleases(apiBaseUrl, refreshToken!, project.id)}
      />
    </section>
  );
}
