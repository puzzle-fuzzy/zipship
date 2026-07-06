import type { RuntimeAdapter } from '@zipship/runtime';
import { useState } from 'react';
import { LoginPage } from './pages/LoginPage';
import './styles/globals.css';

export interface AppProps {
  runtime: RuntimeAdapter;
}

type AuthState =
  | { status: 'loading' }
  | { status: 'login' }
  | { status: 'authenticated'; user: { name: string; email: string } };

export function App({ runtime }: AppProps) {
  const [auth, setAuth] = useState<AuthState>({ status: 'loading' });

  // Simulate checking for existing session on mount
  useState(() => {
    // In the future, check for stored token / session
    setAuth({ status: 'login' });
  });

  const handleLogin = async (email: string, _password: string) => {
    // TODO: Implement actual login via API client
    console.log('Login:', email, 'Runtime:', runtime.kind);
    setAuth({ status: 'authenticated', user: { name: 'Developer', email } });
  };

  const handleRegister = async (name: string, email: string, _password: string) => {
    // TODO: Implement actual register via API client
    console.log('Register:', name, email, 'Runtime:', runtime.kind);
    setAuth({ status: 'authenticated', user: { name, email } });
  };

  if (auth.status === 'loading') {
    return null;
  }

  if (auth.status === 'login') {
    return <LoginPage onLogin={handleLogin} onRegister={handleRegister} />;
  }

  // TODO: Render main app layout (sidebar + content)
  return (
    <main>
      <h1>ZipShip</h1>
      <p>Welcome, {auth.user.name}</p>
      <p>Runtime: {runtime.kind}</p>
    </main>
  );
}
