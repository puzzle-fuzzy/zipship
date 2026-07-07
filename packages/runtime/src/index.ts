export type Platform = "web" | "desktop";

export interface RuntimeAdapter {
  /** The platform kind: "web" or "desktop". */
  platform: Platform;

  /** Base URL for the ZipShip API server. */
  apiBaseUrl: string;

  /** Open an external URL (uses shell.openExternal in Electron, window.open in web). */
  openExternal(url: string): Promise<void>;

  /**
   * Open a native zip-file picker dialog and return the selected File.
   * Only available on desktop (Electron) — web uses a standard <input type="file">.
   */
  selectZipFile?(): Promise<File | null>;

  /** Retrieve the persisted auth token (refresh token). */
  getAuthToken(): string | null;

  /** Persist the auth token for session restore. */
  setAuthToken(token: string): void;

  /** Clear the persisted auth token (logout). */
  clearAuthToken(): void;
}

export function createWebRuntime(apiBaseUrl: string): RuntimeAdapter {
  return {
    platform: "web",
    apiBaseUrl,

    async openExternal(url) {
      window.open(url, "_blank", "noopener,noreferrer");
    },

    getAuthToken() {
      return sessionStorage.getItem("zipship_refresh_token");
    },

    setAuthToken(token) {
      sessionStorage.setItem("zipship_refresh_token", token);
    },

    clearAuthToken() {
      sessionStorage.removeItem("zipship_refresh_token");
    },
    // selectZipFile is intentionally omitted — web uses <input type="file">
  };
}

/**
 * Desktop runtime for Electron renderer process.
 * Checks for window.__zipship_desktop bridge (exposed via preload)
 * and falls back to browser APIs when the bridge is not available (dev mode).
 */
export function createDesktopRuntime(apiBaseUrl: string): RuntimeAdapter {
  const bridge = (window as any).__zipship_desktop;

  return {
    platform: "desktop",
    apiBaseUrl,

    async openExternal(url) {
      if (bridge?.openExternal) {
        await bridge.openExternal(url);
      } else {
        window.open(url, "_blank", "noopener,noreferrer");
      }
    },

    async selectZipFile() {
      if (bridge?.selectZipFile) {
        return bridge.selectZipFile();
      }
      return null;
    },

    getAuthToken() {
      if (bridge?.getAuthToken) {
        return bridge.getAuthToken();
      }
      return localStorage.getItem("zipship_refresh_token");
    },

    setAuthToken(token) {
      if (bridge?.setAuthToken) {
        bridge.setAuthToken(token);
      } else {
        localStorage.setItem("zipship_refresh_token", token);
      }
    },

    clearAuthToken() {
      if (bridge?.clearAuthToken) {
        bridge.clearAuthToken();
      } else {
        localStorage.removeItem("zipship_refresh_token");
      }
    },
  };
}
