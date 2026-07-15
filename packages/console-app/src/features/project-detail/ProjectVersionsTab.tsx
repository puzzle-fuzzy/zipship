import { Clock3, Info, Plus } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Alert, AlertAction, AlertDescription, AlertTitle } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
import { Skeleton } from '../../components/ui/skeleton';
import { useTranslation } from '../../i18n';
import type { Release } from '../../stores/projectsStore';
import { DeploymentConfirmDialog, type DeploymentIntent } from './DeploymentConfirmDialog';
import { ProjectReleasePipeline } from './ProjectReleasePipeline';
import { ProjectVersionsOverview } from './ProjectVersionsOverview';

interface ProjectVersionsTabProps {
  releases: Release[];
  loading: boolean;
  error: string | null;
  autoRefreshing: boolean;
  highlightedReleaseId?: string | null;
  canUpload: boolean;
  canDeploy: boolean;
  canDelete: boolean;
  onUploadClick: () => void;
  onRetry: () => void;
  onPreview: (release: Release) => void;
  onPublish: (release: Release, message?: string | null) => Promise<void>;
  onRollback: (release: Release, message?: string | null) => Promise<void>;
}

export function ProjectVersionsTab({
  releases,
  loading,
  error,
  autoRefreshing,
  highlightedReleaseId = null,
  canUpload,
  canDeploy,
  canDelete,
  onUploadClick,
  onRetry,
  onPreview,
  onPublish,
  onRollback,
}: ProjectVersionsTabProps) {
  const { t } = useTranslation();
  const [deploymentIntent, setDeploymentIntent] = useState<DeploymentIntent | null>(null);
  const [deploymentLoading, setDeploymentLoading] = useState(false);
  const [deploymentMessage, setDeploymentMessage] = useState('');
  const activeRelease = releases.find((release) => release.status === 'active') ?? null;
  const hasReadyRelease = releases.some((release) => release.status === 'ready');

  const openDeploymentConfirm = (release: Release) => {
    const action =
      activeRelease && release.versionNumber < activeRelease.versionNumber
        ? 'rollback'
        : 'publish';
    setDeploymentMessage('');
    setDeploymentIntent({ action, release });
  };

  const confirmDeployment = async () => {
    if (!deploymentIntent) return;

    setDeploymentLoading(true);
    const message = deploymentMessage.trim() || null;
    try {
      if (deploymentIntent.action === 'rollback') {
        await onRollback(deploymentIntent.release, message);
        toast.success(t('toast.rolledBack'));
      } else {
        await onPublish(deploymentIntent.release, message);
        toast.success(t('toast.published'));
      }
      setDeploymentMessage('');
      setDeploymentIntent(null);
    } catch (error) {
      const fallback =
        deploymentIntent.action === 'rollback'
          ? t('toast.rollbackFailed')
          : t('toast.publishFailed');
      toast.error(error instanceof Error ? error.message : fallback);
    } finally {
      setDeploymentLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col gap-3 rounded-lg border bg-card/70 p-4">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <Info />
        <AlertTitle>{t('versions.loadFailedTitle')}</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
        <AlertAction>
          <Button size="sm" variant="outline" onClick={onRetry}>
            {t('common.retry')}
          </Button>
        </AlertAction>
      </Alert>
    );
  }

  if (releases.length === 0) {
    return (
      <div className="flex flex-col gap-3 rounded-lg border border-dashed bg-card/70 p-8 text-center text-sm text-muted-foreground">
        <div className="font-medium text-foreground">{t('versions.empty')}</div>
        <p>{canUpload ? t('versions.emptyDesc') : t('versions.noUploadPermission')}</p>
        <div>
          <Button disabled={!canUpload} onClick={onUploadClick}>
            <Plus data-icon="inline-start" />
            {t('toast.publishVersion')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {!canDeploy && hasReadyRelease ? (
        <Alert>
          <Info />
          <AlertTitle>{t('versions.deployPermissionTitle')}</AlertTitle>
          <AlertDescription>{t('versions.deployPermissionDesc')}</AlertDescription>
        </Alert>
      ) : null}

      {autoRefreshing ? (
        <Alert>
          <Clock3 />
          <AlertTitle>{t('versions.refreshingTitle')}</AlertTitle>
          <AlertDescription>{t('versions.refreshingDesc')}</AlertDescription>
        </Alert>
      ) : null}

      <ProjectVersionsOverview
        activeRelease={activeRelease}
        canUpload={canUpload}
        releases={releases}
        onPreview={onPreview}
        onUploadClick={onUploadClick}
      />
      <ProjectReleasePipeline
        activeRelease={activeRelease}
        canDelete={canDelete}
        canDeploy={canDeploy}
        canUpload={canUpload}
        deploymentLoading={deploymentLoading}
        highlightedReleaseId={highlightedReleaseId}
        releases={releases}
        onDeploy={openDeploymentConfirm}
        onPreview={onPreview}
        onUploadClick={onUploadClick}
      />

      <DeploymentConfirmDialog
        intent={deploymentIntent}
        activeRelease={activeRelease}
        loading={deploymentLoading}
        message={deploymentMessage}
        onMessageChange={setDeploymentMessage}
        onCancel={() => {
          setDeploymentIntent(null);
          setDeploymentMessage('');
        }}
        onConfirm={() => void confirmDeployment()}
      />
    </div>
  );
}
