import type { RuntimeAdapter } from '@zipship/runtime';
import { Suspense, useEffect } from 'react';
import { RouterProvider } from 'react-router';
import { router } from './router';
import { useAuthStore } from './stores';
import { useSettingsStore } from './stores/settingsStore';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Toaster } from './components/primitives/toaster';
import { useTranslation } from './i18n';
import { MaterialIcon } from './components/MaterialIcon';
import './index.css';

export interface AppProps {
  runtime: RuntimeAdapter;
  apiBaseUrl: string;
  accessBaseUrl: string;
}

export function App({ apiBaseUrl, accessBaseUrl }: AppProps) {
  const { status, initSession } = useAuthStore();
  const { t } = useTranslation();

  // Expose base URL so AppLayout can reach it without prop drilling.
  if (typeof window !== 'undefined') {
    (window as any).__ZIPSHIP_API_BASE_URL = apiBaseUrl;
    (window as any).__ZIPSHIP_ACCESS_BASE_URL = accessBaseUrl;
  }

  useEffect(() => {
    useSettingsStore.getState().init();
    initSession();
  }, [initSession]);

  if (status === 'loading') {
    return <AppLoadingState label={t('common.loading')} />;
  }

  return (
    <ErrorBoundary>
      <Suspense fallback={<AppLoadingState label={t('common.loading')} />}>
        <RouterProvider router={router} />
      </Suspense>
      <Toaster />
    </ErrorBoundary>
  );
}

function AppLoadingState({ label }: { label: string }) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background text-muted-foreground">
      <div className="flex items-center gap-2 text-sm" role="status">
        <MaterialIcon name="progress_activity" className="animate-spin" />
        <span>{label}</span>
      </div>
    </main>
  );
}
