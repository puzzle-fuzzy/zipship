import type { RuntimeAdapter } from '@zipship/runtime';
import { useEffect } from 'react';
import { RouterProvider } from 'react-router';
import { router } from './router';
import { useAuthStore } from './stores';
import { LoginPage } from './pages/LoginPage';
import './styles/globals.css';

export interface AppProps {
  runtime: RuntimeAdapter;
  apiBaseUrl: string;
}

export function App({ runtime, apiBaseUrl }: AppProps) {
  const { status, initSession, login, register } = useAuthStore();

  // Expose the base URL so AppLayout can reach it without prop drilling.
  if (typeof window !== 'undefined') {
    (window as any).__ZIPSHIP_API_BASE_URL = apiBaseUrl;
  }

  useEffect(() => {
    initSession(apiBaseUrl);
  }, []);

  if (status === 'loading') {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100dvh',
          color: 'var(--color-text-tertiary)',
        }}
      >
        Loading...
      </div>
    );
  }

  if (status === 'login') {
    return (
      <LoginPage
        onLogin={async (email, password) => {
          await login(apiBaseUrl, email, password, runtime.kind === 'desktop' ? 'desktop' : 'web');
        }}
        onRegister={async (name, email, password) => {
          await register(apiBaseUrl, name, email, password);
        }}
      />
    );
  }

  return <RouterProvider router={router} />;
}
