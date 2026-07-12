import { create } from 'zustand';
import {
  authHeaders,
  clearAccessToken,
  getAccessToken,
  getApi,
  setAccessToken,
} from '../api/client';
import { API_ERROR_MESSAGES, mapApiError } from '../api/errors';

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

  initSession: () => Promise<void>;
  login: (email: string, password: string, clientType: 'web' | 'desktop') => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  logout: () => void;
  updateProfile: (name: string) => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  status: 'loading',
  user: null,
  refreshToken: null,

  initSession: async () => {
    const saved = getAccessToken();
    if (!saved) {
      set({ status: 'login' });
      return;
    }

    try {
      const api = getApi();
      const res = await api._api.auth.me.get({
        headers: { authorization: `Bearer ${saved}` },
      });

      if (res.data) {
        set({ status: 'authenticated', user: res.data.user, refreshToken: saved });
      } else {
        clearAccessToken();
        set({ status: 'login' });
      }
    } catch {
      clearAccessToken();
      set({ status: 'login' });
    }
  },

  login: async (email, password, clientType) => {
    const api = getApi();
    const res = await api._api.auth.login.post({ email, password, clientType });

    if (res.error) {
      throw mapApiError(res, {
        codes: {
          INVALID_CREDENTIALS: API_ERROR_MESSAGES.INVALID_CREDENTIALS,
          UNAUTHORIZED: API_ERROR_MESSAGES.INVALID_CREDENTIALS,
          VALIDATION_ERROR: API_ERROR_MESSAGES.VALIDATION_ERROR,
        },
        fallback: 'Login failed',
      });
    }

    if (!res.data) {
      throw new Error('Login failed — empty response');
    }

    const data = res.data;
    setAccessToken(data.session.refreshToken);
    set({ status: 'authenticated', user: data.user, refreshToken: data.session.refreshToken });
  },

  register: async (name, email, password) => {
    const api = getApi();
    const res = await api._api.auth.register.post({ name, email, password, clientType: 'web' });

    if (res.error) {
      throw mapApiError(res, {
        codes: {
          DUPLICATE_EMAIL: API_ERROR_MESSAGES.DUPLICATE_EMAIL,
          INVALID_INPUT: API_ERROR_MESSAGES.INVALID_INPUT,
        },
        fallback: 'Registration failed',
      });
    }

    // Registration already returns a session — no separate login call needed.
    setAccessToken(res.data.session.refreshToken);
    set({
      status: 'authenticated',
      user: res.data.user,
      refreshToken: res.data.session.refreshToken,
    });
  },

  logout: () => {
    clearAccessToken();
    set({ status: 'login', user: null, refreshToken: null });
  },

  updateProfile: async (name) => {
    const token = getAccessToken();
    if (!token) throw new Error('Not authenticated');
    const api = getApi();
    const res = await api._api.auth.me.patch(
      { name },
      { headers: { authorization: `Bearer ${token}` } },
    );
    if (res.error) throw new Error('Failed to update profile');
    if (res.data) {
      set({ user: res.data.user });
    }
  },
}));

// Re-exported for components that still want a typed header builder.
export { authHeaders };
