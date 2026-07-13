import { defineStore } from 'pinia';
import { ref } from 'vue';
import { API_ERROR_MESSAGES, mapApiError, type TreatyError } from '../api/errors';
import { useConsoleAppContext } from '../app/context';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
}

export type AuthStatus = 'loading' | 'login' | 'authenticated';

export const useAuthStore = defineStore('auth', () => {
  const context = useConsoleAppContext();
  const status = ref<AuthStatus>('loading');
  const user = ref<AuthUser | null>(null);

  async function initSession(): Promise<void> {
    status.value = 'loading';
    const token = context.sessionToken.value;

    if (!token) {
      clearSession();
      return;
    }

    try {
      const response = await context.api._api.auth.me.get({
        headers: context.authHeaders(),
      });

      if (response.error || !response.data) {
        clearSession();
        return;
      }

      user.value = response.data.user;
      status.value = 'authenticated';
    } catch {
      clearSession();
    }
  }

  async function login(email: string, password: string): Promise<void> {
    const response = await context.api._api.auth.login.post({
      email,
      password,
      clientType: context.runtime.kind,
    });

    if (response.error) {
      throw mapApiError(toTreatyError(response.error), {
        codes: {
          INVALID_CREDENTIALS: API_ERROR_MESSAGES.INVALID_CREDENTIALS,
          UNAUTHORIZED: API_ERROR_MESSAGES.INVALID_CREDENTIALS,
          VALIDATION_ERROR: API_ERROR_MESSAGES.VALIDATION_ERROR,
        },
        fallback: 'Login failed',
      });
    }

    if (!response.data) {
      throw new Error('Login failed — empty response');
    }

    authenticate(response.data.user, response.data.session.refreshToken);
  }

  async function register(name: string, email: string, password: string): Promise<void> {
    const response = await context.api._api.auth.register.post({
      name,
      email,
      password,
      clientType: context.runtime.kind,
    });

    if (response.error) {
      throw mapApiError(toTreatyError(response.error), {
        codes: {
          DUPLICATE_EMAIL: API_ERROR_MESSAGES.DUPLICATE_EMAIL,
          INVALID_REGISTRATION_INPUT: API_ERROR_MESSAGES.INVALID_INPUT,
          INVALID_INPUT: API_ERROR_MESSAGES.INVALID_INPUT,
          VALIDATION_ERROR: API_ERROR_MESSAGES.VALIDATION_ERROR,
        },
        fallback: 'Registration failed',
      });
    }

    if (!response.data) {
      throw new Error('Registration failed — empty response');
    }

    authenticate(response.data.user, response.data.session.refreshToken);
  }

  async function logout(): Promise<void> {
    try {
      const response = await context.api._api.auth.logout.post(undefined, {
        headers: context.authHeaders(),
      });

      if (response.error) {
        throw mapApiError(toTreatyError(response.error), {
          codes: {
            UNAUTHORIZED: API_ERROR_MESSAGES.UNAUTHORIZED,
          },
          fallback: 'Logout failed',
        });
      }
    } finally {
      clearSession();
    }
  }

  async function updateProfile(name: string): Promise<void> {
    if (!context.sessionToken.value) {
      throw new Error('Not authenticated');
    }

    const response = await context.api._api.auth.me.patch(
      { name },
      { headers: context.authHeaders() },
    );

    if (response.error) {
      throw new Error('Failed to update profile');
    }

    if (response.data) {
      user.value = response.data.user;
    }
  }

  function clearSession(): void {
    context.sessionToken.value = null;
    user.value = null;
    status.value = 'login';
  }

  function authenticate(authenticatedUser: AuthUser, refreshToken: string): void {
    context.sessionToken.value = refreshToken;
    user.value = authenticatedUser;
    status.value = 'authenticated';
  }

  return {
    status,
    user,
    initSession,
    login,
    register,
    logout,
    updateProfile,
    clearSession,
  };
});

function toTreatyError(error: { status: number; value: unknown }): TreatyError {
  return {
    status: error.status,
    error: { value: error.value },
  };
}
