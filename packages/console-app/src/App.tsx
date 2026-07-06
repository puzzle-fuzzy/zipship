import { createApiClient } from '@zipship/api-client';
import type { RuntimeAdapter } from '@zipship/runtime';
import { useCallback, useEffect, useState } from 'react';
import { Layout } from './features/layout/Layout';
import { LoginPage } from './pages/LoginPage';
import { CreateProjectDialog } from './features/projects/CreateProjectDialog';
import { ProjectList } from './features/projects/ProjectList';
import { Breadcrumb } from './shared/ui/Breadcrumb';
import { Card } from './shared/ui/Card';
import { Tabs } from './shared/ui/Tabs';
import './styles/globals.css';

export interface AppProps {
  runtime: RuntimeAdapter;
  apiBaseUrl: string;
}

interface AuthUser {
  id: string;
  name: string;
  email: string;
}

interface Project {
  id: string;
  organizationId: string;
  name: string;
  slug: string;
  description: string | null;
  currentReleaseId: string | null;
  status: string;
  visibility: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

interface Release {
  id: string;
  projectId: string;
  versionNumber: number;
  releaseHash: string;
  previewUrl: string | null;
  fullHash: string;
  status: string;
  storagePath: string;
  rawUploadPath: string;
  fileCount: number;
  totalSize: number;
  manifest: Record<string, unknown>;
  detectResult: Record<string, unknown>;
  createdBy: string;
  createdAt: string;
  activatedAt: string | null;
  archivedAt: string | null;
}

type Page = { kind: 'projects' } | { kind: 'project'; projectId: string };

export function App({ runtime, apiBaseUrl }: AppProps) {
  const [auth, setAuth] = useState<AuthUser | null>(null);
  const [refreshToken, setRefreshToken] = useState<string | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState<Page>({ kind: 'projects' });
  const [showCreate, setShowCreate] = useState(false);

  const api = createApiClient(apiBaseUrl);

  // Check session on mount
  useEffect(() => {
    const saved = sessionStorage.getItem('zipship_refresh_token');
    if (saved) {
      api._api.auth.me
        .get({ headers: { authorization: `Bearer ${saved}` } })
        .then((res) => {
          if (res.data) {
            setAuth(res.data.user);
            setRefreshToken(saved);
          } else {
            sessionStorage.removeItem('zipship_refresh_token');
          }
        })
        .catch(() => {
          sessionStorage.removeItem('zipship_refresh_token');
        });
    }
    setLoading(false);
  }, []);

  // Fetch projects when authenticated
  useEffect(() => {
    if (!refreshToken) return;
    api._api.organizations
      .get({ headers: { authorization: `Bearer ${refreshToken}` } })
      .then(async (orgRes) => {
        const orgId = orgRes.data?.organizations[0]?.id;
        if (!orgId) return;
        const projRes = await api._api.organizations({ organizationId: orgId }).projects.get({
          headers: { authorization: `Bearer ${refreshToken}` },
        });
        if (projRes.data) {
          setProjects(projRes.data.projects as Project[]);
        }
      })
      .catch(console.error);
  }, [refreshToken]);

  const handleLogin = async (email: string, password: string) => {
    const response = await api._api.auth.login.post({
      email,
      password,
      clientType: runtime.kind === 'desktop' ? 'desktop' : 'web',
    });

    if (response.error) {
      const code = (response.error.value as { code?: string })?.code;
      const messages: Record<string, string> = {
        INVALID_CREDENTIALS: 'Invalid email or password',
        UNAUTHORIZED: 'Invalid email or password',
      };
      throw new Error(messages[code ?? ''] ?? 'Login failed');
    }

    const data = response.data!;
    sessionStorage.setItem('zipship_refresh_token', data.session.refreshToken);
    setAuth(data.user);
    setRefreshToken(data.session.refreshToken);
  };

  const handleRegister = async (name: string, email: string, password: string) => {
    const response = await api._api.auth.register.post({ name, email, password });
    if (response.error) {
      const code = (response.error.value as { code?: string })?.code;
      const messages: Record<string, string> = {
        DUPLICATE_EMAIL: 'An account with this email already exists',
        INVALID_INPUT: 'Please check your input and try again',
      };
      throw new Error(messages[code ?? ''] ?? 'Registration failed');
    }
    await handleLogin(email, password);
  };

  const handleLogout = async () => {
    sessionStorage.removeItem('zipship_refresh_token');
    setAuth(null);
    setRefreshToken(null);
    setProjects([]);
    setPage({ kind: 'projects' });
  };

  const handleCreateProject = async (input: { name: string; slug: string; description: string }) => {
    if (!refreshToken) return;
    const orgRes = await api._api.organizations.get({
      headers: { authorization: `Bearer ${refreshToken}` },
    });
    const orgId = orgRes.data?.organizations[0]?.id;
    if (!orgId) return;

    const res = await api._api.organizations({ organizationId: orgId }).projects.post(
      { name: input.name, slug: input.slug, description: input.description || null },
      { headers: { authorization: `Bearer ${refreshToken}` } },
    );

    if (res.error) {
      const code = (res.error.value as { code?: string })?.code;
      throw new Error(code === 'DUPLICATE_PROJECT_SLUG' ? 'A project with this slug already exists' : 'Failed to create project');
    }

    await refreshProjects();
  };

  const refreshProjects = useCallback(async () => {
    if (!refreshToken) return;
    const orgRes = await api._api.organizations.get({
      headers: { authorization: `Bearer ${refreshToken}` },
    });
    const orgId = orgRes.data?.organizations[0]?.id;
    if (!orgId) return;
    const projRes = await api._api.organizations({ organizationId: orgId }).projects.get({
      headers: { authorization: `Bearer ${refreshToken}` },
    });
    if (projRes.data) {
      setProjects(projRes.data.projects as Project[]);
    }
  }, [refreshToken]);

  const selectedProject = page.kind === 'project'
    ? projects.find((p) => p.id === page.projectId) ?? null
    : null;

  // Show loading state
  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100dvh', color: 'var(--color-text-tertiary)' }}>
        Loading...
      </div>
    );
  }

  // Show login
  if (!auth) {
    return <LoginPage onLogin={handleLogin} onRegister={handleRegister} />;
  }

  // Authenticated — show layout
  return (
    <>
      <Layout
        user={auth}
        projects={projects}
        selectedProjectId={selectedProject?.id ?? null}
        onSelectProject={(project) => {
          if (project) {
            setPage({ kind: 'project', projectId: project.id });
          } else {
            setPage({ kind: 'projects' });
          }
        }}
        onCreateProject={() => setShowCreate(true)}
        onLogout={handleLogout}
        headerExtra={
          selectedProject ? (
            <Breadcrumb
              items={[
                { label: 'Projects', onClick: () => setPage({ kind: 'projects' }) },
                { label: selectedProject.name },
              ]}
            />
          ) : (
            <Breadcrumb items={[{ label: 'Projects' }]} />
          )
        }
      >
        {!selectedProject ? (
          <ProjectList
            projects={projects}
            loading={false}
            onSelect={(p) => setPage({ kind: 'project', projectId: p.id })}
            onCreate={() => {}}
            onRefresh={refreshProjects}
          />
        ) : (
          <ProjectDetailSection
            project={selectedProject}
            refreshToken={refreshToken!}
            apiBaseUrl={apiBaseUrl}
          />
        )}
      </Layout>

      <CreateProjectDialog
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={async ({ name, slug, description }) => {
          try {
            await handleCreateProject({ name, slug, description });
            setShowCreate(false);
          } catch (err) {
            console.error(err);
          }
        }}
      />
    </>
  );
}

// ─── Project Detail ───

function ProjectDetailSection({
  project,
  refreshToken,
  apiBaseUrl,
}: {
  project: Project;
  refreshToken: string;
  apiBaseUrl: string;
}) {
  const [releases, setReleases] = useState<Release[]>([]);
  const [loading, setLoading] = useState(true);
  const api = createApiClient(apiBaseUrl);

  useEffect(() => {
    api._api.projects({ projectId: project.id }).releases
      .get({ headers: { authorization: `Bearer ${refreshToken}` } })
      .then((res) => {
        if (res.data) setReleases(res.data.releases as Release[]);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [project.id]);

  const activeRelease = releases.find((r) => r.status === 'active');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <Tabs
        tabs={[
          {
            id: 'versions',
            label: 'Versions',
            content: (
              <Card title="Versions" description={`${releases.length} total`}>
                {loading ? (
                  <p style={{ color: 'var(--color-text-tertiary)' }}>Loading...</p>
                ) : releases.length === 0 ? (
                  <p style={{ color: 'var(--color-text-secondary)', textAlign: 'center', padding: 24 }}>
                    No versions uploaded yet
                  </p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {releases.map((release) => (
                      <div
                        key={release.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '12px 16px',
                          border: '1px solid var(--color-border)',
                          borderRadius: 6,
                        }}
                      >
                        <div>
                          <div style={{ fontWeight: 500 }}>
                            v{release.versionNumber}
                            {release.releaseHash && ` (${release.releaseHash})`}
                          </div>
                          <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)' }}>
                            {release.fileCount} files · {Math.round(release.totalSize / 1024)} KB
                          </div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span
                            style={{
                              padding: '2px 8px',
                              borderRadius: 999,
                              fontSize: 'var(--font-size-xs)',
                              fontWeight: 500,
                              background:
                                release.status === 'active'
                                  ? 'var(--color-success-bg)'
                                  : release.status === 'ready'
                                    ? 'var(--color-bg-tertiary)'
                                    : 'transparent',
                              color:
                                release.status === 'active'
                                  ? 'var(--color-success)'
                                  : 'var(--color-text-secondary)',
                              border: release.status === 'ready' ? '1px solid var(--color-border)' : 'none',
                            }}
                          >
                            {release.status}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            ),
          },
          {
            id: 'settings',
            label: 'Settings',
            content: (
              <Card title="Project Settings">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <div>
                    <div style={{ fontSize: 'var(--font-size-sm)', fontWeight: 500, marginBottom: 4 }}>Name</div>
                    <div style={{ fontSize: 'var(--font-size-base)' }}>{project.name}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 'var(--font-size-sm)', fontWeight: 500, marginBottom: 4 }}>Slug</div>
                    <div style={{ fontSize: 'var(--font-size-base)' }}>{project.slug}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 'var(--font-size-sm)', fontWeight: 500, marginBottom: 4 }}>Description</div>
                    <div style={{ fontSize: 'var(--font-size-base)' }}>{project.description ?? '—'}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 'var(--font-size-sm)', fontWeight: 500, marginBottom: 4 }}>Deploy URL</div>
                    <div style={{ fontSize: 'var(--font-size-base)' }}>
                      {activeRelease ? (
                        <code style={{ fontSize: 'var(--font-size-sm)', padding: '2px 6px', background: 'var(--color-bg-tertiary)', borderRadius: 4 }}>
                          /{project.slug}/{activeRelease.releaseHash}/
                        </code>
                      ) : (
                        <span style={{ color: 'var(--color-text-tertiary)' }}>Publish a version to see the URL</span>
                      )}
                    </div>
                  </div>
                </div>
              </Card>
            ),
          },
        ]}
      />
    </div>
  );
}
