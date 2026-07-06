import type { RuntimeAdapter } from '@zipship/runtime';
import { useEffect } from 'react';
import { RouterProvider } from 'react-router';
import { router } from './router';
import { useAuthStore } from './stores';
import { useSettingsStore } from './stores/settingsStore';
import { LoginPage } from './pages/LoginPage';
import { Toaster } from './components/ui/sonner';
import { toast } from 'sonner';
import './index.css';

export interface AppProps {
  runtime: RuntimeAdapter;
  apiBaseUrl: string;
}

export function App({ runtime, apiBaseUrl }: AppProps) {
  const { status, initSession, login, register } = useAuthStore();

  // Expose base URL so AppLayout can reach it without prop drilling.
  if (typeof window !== 'undefined') {
    (window as any).__ZIPSHIP_API_BASE_URL = apiBaseUrl;
  }

  useEffect(() => {
    useSettingsStore.getState().init();
    initSession(apiBaseUrl);
  }, []);

  const handleLogin = async (email: string, password: string) => {
    try {
      await login(apiBaseUrl, email, password, runtime.kind === 'desktop' ? 'desktop' : 'web');
    } catch (err) {
      toast.error((err as Error).message || 'Login failed');
    }
  };

  const handleRegister = async (name: string, email: string, password: string) => {
    try {
      await register(apiBaseUrl, name, email, password);
    } catch (err) {
      toast.error((err as Error).message || 'Registration failed');
    }
  };

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
      <>
        <LoginPage onLogin={handleLogin} onRegister={handleRegister} />
        <Toaster />
      </>
    );
  }

  return (
    <>
      <RouterProvider router={router} />
      <Toaster />
    </>
  );
}
