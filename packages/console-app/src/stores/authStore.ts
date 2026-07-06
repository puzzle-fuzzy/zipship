import { createApiClient } from '@zipship/api-client';
import type { RuntimeAdapter } from '@zipship/runtime';
import { create } from 'zustand';

interface AuthUser {
  id: string;
  name: string;
  email: string;
}

type AuthStatus = 'loading' | 'login' | 'authenticated';

interface AuthState {
  status: AuthStatus;
  user: AuthUser | null;
  refreshToken: string | null;

  initSession: (apiBaseUrl: string) => Promise<void>;
  login: (apiBaseUrl: string, email: string, password: string, clientType: 'web' | 'desktop') => Promise<void>;
  register: (apiBaseUrl: string, name: string, email: string, password: string) => Promise<void>;
  logout: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  status: 'loading',
  user: null,
  refreshToken: null,

  initSession: async (apiBaseUrl: string) => {
    const saved = sessionStorage.getItem('zipship_refresh_token');
    if (!saved) {
      set({ status: 'login' });
      return;
    }

    try {
      const api = createApiClient(apiBaseUrl);
      const res = await api._api.auth.me.get({
        headers: { authorization: `Bearer ${saved}` },
      });

      if (res.data) {
        set({ status: 'authenticated', user: res.data.user, refreshToken: saved });
      } else {
        sessionStorage.removeItem('zipship_refresh_token');
        set({ status: 'login' });
      }
    } catch {
      sessionStorage.removeItem('zipship_refresh_token');
      set({ status: 'login' });
    }
  },

  login: async (apiBaseUrl, email, password, clientType) => {
    const api = createApiClient(apiBaseUrl);
    const res = await api._api.auth.login.post({ email, password, clientType });

    if (res.error) {
      const status = res.status;
      const errPayload = res.error.value as Record<string, unknown> | undefined;
      const code = errPayload?.code as string | undefined;
      console.error('Login failed', { status, code, errPayload, error: res.error });
      const messages: Record<string, string> = {
        INVALID_CREDENTIALS: 'Invalid email or password',
        UNAUTHORIZED: 'Invalid email or password',
        VALIDATION_ERROR: 'Validation failed — check your input',
      };
      throw new Error(messages[code ?? ''] ?? `Login failed (${code ?? `HTTP ${status}`})`);
    }

    if (!res.data) {
      throw new Error('Login failed — empty response');
    }

    const data = res.data!;
    sessionStorage.setItem('zipship_refresh_token', data.session.refreshToken);
    set({ status: 'authenticated', user: data.user, refreshToken: data.session.refreshToken });
  },

  register: async (apiBaseUrl, name, email, password) => {
    const api = createApiClient(apiBaseUrl);
    const res = await api._api.auth.register.post({ name, email, password });

    if (res.error) {
      const code = (res.error.value as { code?: string })?.code;
      const messages: Record<string, string> = {
        DUPLICATE_EMAIL: 'An account with this email already exists',
        INVALID_INPUT: 'Please check your input and try again',
      };
      throw new Error(messages[code ?? ''] ?? 'Registration failed');
    }

    // Auto-login after registration
    const loginApi = createApiClient(apiBaseUrl);
    const loginRes = await loginApi._api.auth.login.post({
      email,
      password,
      clientType: 'web',
    });

    if (loginRes.error) {
      throw new Error('Account created but login failed');
    }

    sessionStorage.setItem('zipship_refresh_token', loginRes.data!.session.refreshToken);
    set({
      status: 'authenticated',
      user: loginRes.data!.user,
      refreshToken: loginRes.data!.session.refreshToken,
    });
  },

  logout: () => {
    sessionStorage.removeItem('zipship_refresh_token');
    set({ status: 'login', user: null, refreshToken: null });
  },
}));
