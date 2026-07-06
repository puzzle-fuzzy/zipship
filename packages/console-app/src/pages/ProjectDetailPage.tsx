import { IconUpload, IconUserPlus } from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useAuthStore, useProjectsStore } from '../stores';
import { useTranslation } from '../i18n';
import { Button } from '../shared/ui/Button';
import { Breadcrumb } from '../shared/ui/Breadcrumb';
import { Card } from '../shared/ui/Card';
import { Tabs } from '../shared/ui/Tabs';
import { UploadVersionDialog } from '../features/versions/UploadVersionDialog';
import styles from './ProjectDetailPage.module.css';

const BADGE_CLASSES: Record<string, string> = {
  active: 'statusBadgeActive',
  ready: 'statusBadgeReady',
};

function statusBadgeClass(status: string): string {
  return BADGE_CLASSES[status] ?? 'statusBadgeDefault';
}

export function ProjectDetailPage() {
  const { t } = useTranslation();
  const { projectId } = useParams();
  const { refreshToken } = useAuthStore();
  const { projects, releases, fetchReleases } = useProjectsStore();
  const navigate = useNavigate();
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
    return <p className={styles.loadingState}>{t('common.loading')}</p>;
  }

  const activeRelease = projectReleases.find((r) => r.status === 'active');

  return (
    <div className={styles.page}>
      <Breadcrumb
        items={[
          { label: t('projects.title'), onClick: () => navigate('/app') },
          { label: project.name },
        ]}
      />

      <Tabs
        tabs={[
          {
            id: 'versions',
            label: t('versions.title'),
            content: (
              <Card title={t('versions.title')} description={t('versions.total', { count: projectReleases.length })}
                action={
                  <Button size="sm" onClick={() => setShowUpload(true)}>
                    <IconUpload size={14} />
                    {t('versions.upload')}
                  </Button>
                }>
                {loading ? (
                  <p className={styles.loadingText}>{t('common.loading')}</p>
                ) : projectReleases.length === 0 ? (
                  <p className={styles.emptyText}>{t('versions.empty')}</p>
                ) : (
                  <div className={styles.releaseList}>
                    {projectReleases.map((release) => {
                      return (
                        <div key={release.id} className={styles.releaseRow}>
                          <div>
                            <div className={styles.releaseInfo}>
                              v{release.versionNumber}
                              {release.releaseHash && ` (${release.releaseHash})`}
                            </div>
                            <div className={styles.releaseMeta}>
                              {t('versions.files', { count: release.fileCount })} · {t('versions.size', { size: Math.round(release.totalSize / 1024) })}
                            </div>
                          </div>
                          <span className={styles[statusBadgeClass(release.status)]}>
                            {release.status === 'active'
                              ? t('versions.status.active')
                              : release.status === 'ready'
                                ? t('versions.status.ready')
                                : release.status === 'failed'
                                  ? t('versions.status.failed')
                                  : release.status}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </Card>
            ),
          },
          {
            id: 'members',
            label: t('members.title'),
            content: (
              <Card
                title={t('members.title')}
                action={
                  <Button size="sm">
                    <IconUserPlus size={14} />
                    {t('members.invite')}
                  </Button>
                }
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {[1, 2, 3].map((i) => {
                    const roles: Record<number, string> = { 1: 'owner', 2: 'admin', 3: 'developer' };
                    const role = roles[i] ?? 'viewer';
                    return (
                      <div
                        key={i}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 12,
                          padding: '10px 12px',
                          borderRadius: 6,
                        }}
                      >
                        <div
                          style={{
                            width: 32,
                            height: 32,
                            borderRadius: '50%',
                            background: 'var(--color-bg-tertiary)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: 'var(--font-size-xs)',
                            fontWeight: 500,
                            color: 'var(--color-text-secondary)',
                          }}
                        >
                          U{i}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 'var(--font-size-sm)', fontWeight: 500 }}>
                            User {i}
                          </div>
                          <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)' }}>
                            user{i}@example.com
                          </div>
                        </div>
                        <span
                          style={{
                            fontSize: 'var(--font-size-xs)',
                            color: 'var(--color-text-secondary)',
                            background: 'var(--color-bg-tertiary)',
                            padding: '2px 8px',
                            borderRadius: 999,
                          }}
                        >
                          {t(`members.${role}`)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </Card>
            ),
          },
          {
            id: 'settings',
            label: t('settings.title'),
            content: (
              <Card title={t('settings.title')}>
                <div className={styles.settingsSection}>
                  <div className={styles.settingsField}>
                    <div className={styles.settingsLabel}>{t('projects.name')}</div>
                    <div className={styles.settingsValue}>{project.name}</div>
                  </div>
                  <div className={styles.settingsField}>
                    <div className={styles.settingsLabel}>{t('projects.slug')}</div>
                    <div className={styles.settingsValue}>{project.slug}</div>
                  </div>
                  <div className={styles.settingsField}>
                    <div className={styles.settingsLabel}>{t('projects.description')}</div>
                    <div className={styles.settingsValue}>{project.description ?? '—'}</div>
                  </div>
                  <div className={styles.settingsField}>
                    <div className={styles.settingsLabel}>{t('settings.deployUrl')}</div>
                    <div className={styles.settingsValue}>
                      {activeRelease ? (
                        <code className={styles.settingsCode}>
                          /{project.slug}/{activeRelease.releaseHash}/
                        </code>
                      ) : (
                        <span className={styles.settingsMuted}>{t('settings.noDeployed')}</span>
                      )}
                    </div>
                  </div>
                </div>
              </Card>
            ),
          },
        ]}
      />

      <UploadVersionDialog
        open={showUpload}
        onClose={() => setShowUpload(false)}
        projectId={project.id}
        refreshToken={refreshToken!}
        apiBaseUrl={apiBaseUrl}
        onUploaded={() => fetchReleases(apiBaseUrl, refreshToken!, project.id)}
      />
    </div>
  );
}
