import { create } from "zustand";
import { getApi, getCsrfHeaders } from "../api/client";
import { API_ERROR_MESSAGES, mapApiError } from "../api/errors";

interface AuthUser {
  id: string;
  name: string;
  email: string;
}

type AuthStatus = "loading" | "login" | "authenticated";

interface AuthState {
  status: AuthStatus;
  user: AuthUser | null;

  initSession: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  updateProfile: (name: string) => Promise<void>;
  requestPasswordReset: (email: string) => Promise<void>;
  confirmPasswordReset: (token: string, password: string) => Promise<void>;
}

function userView(user: {
  id: string;
  email: string;
  displayName: string;
}): AuthUser {
  return { id: user.id, email: user.email, name: user.displayName };
}

export const useAuthStore = create<AuthState>((set) => ({
  status: "loading",
  user: null,

  initSession: async () => {
    try {
      const result = await getApi().GET("/_api/auth/me");
      if (result.data) {
        set({ status: "authenticated", user: userView(result.data.user) });
        return;
      }
    } catch {
      // Network failures and absent sessions share the signed-out boundary.
    }
    set({ status: "login", user: null });
  },

  login: async (email, password) => {
    const result = await getApi().POST("/_api/auth/login", {
      body: { email, password },
    });
    if (result.error || !result.data) {
      throw mapApiError(result, {
        codes: {
          INVALID_CREDENTIALS: API_ERROR_MESSAGES.INVALID_CREDENTIALS,
          ACCOUNT_DISABLED: API_ERROR_MESSAGES.ACCOUNT_DISABLED,
          INVALID_EMAIL: API_ERROR_MESSAGES.INVALID_EMAIL,
          INVALID_PASSWORD: API_ERROR_MESSAGES.INVALID_PASSWORD,
        },
        fallback: "Login failed",
      });
    }
    set({ status: "authenticated", user: userView(result.data.user) });
  },

  register: async (name, email, password) => {
    const result = await getApi().POST("/_api/auth/register", {
      body: { displayName: name, email, password },
    });
    if (result.error || !result.data) {
      throw mapApiError(result, {
        codes: {
          DUPLICATE_EMAIL: API_ERROR_MESSAGES.DUPLICATE_EMAIL,
          INVALID_EMAIL: API_ERROR_MESSAGES.INVALID_EMAIL,
          INVALID_DISPLAY_NAME: API_ERROR_MESSAGES.INVALID_DISPLAY_NAME,
          INVALID_PASSWORD: API_ERROR_MESSAGES.INVALID_PASSWORD,
        },
        fallback: "Registration failed",
      });
    }
    set({ status: "authenticated", user: userView(result.data.user) });
  },

  logout: async () => {
    const result = await getApi().POST("/_api/auth/logout", {
      params: { header: getCsrfHeaders() },
    });
    if (result.error) {
      throw mapApiError(result, {
        codes: {
          INVALID_CSRF_TOKEN: API_ERROR_MESSAGES.INVALID_CSRF_TOKEN,
          UNAUTHENTICATED: API_ERROR_MESSAGES.UNAUTHENTICATED,
        },
        fallback: "Sign out failed",
      });
    }
    set({ status: "login", user: null });
  },

  updateProfile: async (name) => {
    const result = await getApi().PATCH("/_api/auth/me", {
      params: { header: getCsrfHeaders() },
      body: { displayName: name },
    });
    if (result.error || !result.data) {
      throw mapApiError(result, {
        codes: {
          INVALID_DISPLAY_NAME: API_ERROR_MESSAGES.INVALID_DISPLAY_NAME,
          INVALID_CSRF_TOKEN: API_ERROR_MESSAGES.INVALID_CSRF_TOKEN,
        },
        fallback: "Failed to update profile",
      });
    }
    set({ user: userView(result.data.user) });
  },

  requestPasswordReset: async (email) => {
    const result = await getApi().POST("/_api/auth/password-resets", {
      body: { email },
    });
    if (result.error) {
      throw mapApiError(result, {
        codes: {},
        fallback: "Password reset request failed",
      });
    }
  },

  confirmPasswordReset: async (token, password) => {
    const result = await getApi().POST("/_api/auth/password-resets/confirm", {
      body: { token, password },
    });
    if (result.error) {
      throw mapApiError(result, {
        codes: {
          INVALID_PASSWORD_RESET_TOKEN:
            API_ERROR_MESSAGES.INVALID_PASSWORD_RESET_TOKEN,
          INVALID_PASSWORD: API_ERROR_MESSAGES.INVALID_PASSWORD,
          ANONYMOUS_RATE_LIMITED: API_ERROR_MESSAGES.ANONYMOUS_RATE_LIMITED,
        },
        fallback: "Password reset failed",
      });
    }
    set({ status: "login", user: null });
  },
}));
