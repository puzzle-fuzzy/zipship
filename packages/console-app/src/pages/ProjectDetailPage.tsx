import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useAuthStore, useProjectsStore, type Project } from '../stores';
import { Breadcrumb } from '../shared/ui/Breadcrumb';
import { Card } from '../shared/ui/Card';
import { Tabs } from '../shared/ui/Tabs';

export function ProjectDetailPage() {
  const { projectId } = useParams();
  const { refreshToken } = useAuthStore();
  const { projects, releases, fetchReleases } = useProjectsStore();
  const navigate = useNavigate();

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
    return <p style={{ color: 'var(--color-text-tertiary)', padding: 24 }}>Project not found</p>;
  }

  const activeRelease = projectReleases.find((r) => r.status === 'active');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <Breadcrumb
        items={[
          { label: 'Projects', onClick: () => navigate('/app') },
          { label: project.name },
        ]}
      />

      <Tabs
        tabs={[
          {
            id: 'versions',
            label: 'Versions',
            content: (
              <Card title="Versions" description={`${projectReleases.length} total`}>
                {loading ? (
                  <p style={{ color: 'var(--color-text-tertiary)' }}>Loading...</p>
                ) : projectReleases.length === 0 ? (
                  <p style={{ color: 'var(--color-text-secondary)', textAlign: 'center', padding: 24 }}>
                    No versions uploaded yet
                  </p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {projectReleases.map((release) => (
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
                              release.status === 'active' ? 'var(--color-success)' : 'var(--color-text-secondary)',
                            border: release.status === 'ready' ? '1px solid var(--color-border)' : 'none',
                          }}
                        >
                          {release.status}
                        </span>
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
