import type { RuntimeAdapter } from '@zipship/runtime';
import { LoaderCircle } from 'lucide-react';
import { useEffect } from 'react';
import { RouterProvider } from 'react-router';
import { router } from './router';
import { useAuthStore } from './stores';
import { useSettingsStore } from './stores/settingsStore';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Toaster } from './components/ui/sonner';
import { useTranslation } from './i18n';
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
    return (
      <main className="flex min-h-dvh items-center justify-center bg-background text-muted-foreground">
        <div className="flex items-center gap-2 text-sm" role="status">
          <LoaderCircle className="animate-spin" aria-hidden="true" />
          <span>{t('common.loading')}</span>
        </div>
      </main>
    );
  }

  return (
    <ErrorBoundary>
      <RouterProvider router={router} />
      <Toaster />
    </ErrorBoundary>
  );
}
