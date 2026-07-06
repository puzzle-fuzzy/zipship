import { createApiClient } from '@zipship/api-client';
import type { RuntimeAdapter } from '@zipship/runtime';
import { useState } from 'react';
import { LoginPage } from './pages/LoginPage';
import './styles/globals.css';

export interface AppProps {
  runtime: RuntimeAdapter;
  apiBaseUrl: string;
}

type AuthUser = { id: string; name: string; email: string };

type AuthState =
  | { status: 'loading' }
  | { status: 'login' }
  | { status: 'authenticated'; user: AuthUser; refreshToken: string };

export function App({ runtime, apiBaseUrl }: AppProps) {
  const [auth, setAuth] = useState<AuthState>({ status: 'loading' });

  // Check for existing session on mount
  useState(() => {
    const saved = sessionStorage.getItem('zipship_refresh_token');
    if (saved) {
      // TODO: validate session with GET /me
      setAuth({ status: 'login' });
    } else {
      setAuth({ status: 'login' });
    }
  });

  const api = createApiClient(apiBaseUrl);

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

    setAuth({
      status: 'authenticated',
      user: data.user,
      refreshToken: data.session.refreshToken,
    });
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

    // Auto-login after registration
    await handleLogin(email, password);
  };

  if (auth.status === 'loading') {
    return null;
  }

  if (auth.status === 'login') {
    return <LoginPage onLogin={handleLogin} onRegister={handleRegister} />;
  }

  // Authenticated — render main app layout
  return (
    <main>
      <h1>ZipShip</h1>
      <p>Welcome, {auth.user.name}</p>
      <p>Runtime: {runtime.kind}</p>
    </main>
  );
}
