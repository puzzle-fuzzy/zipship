interface ZipShipDesktopAPI {
  openExternal(url: string): Promise<void>;
  selectZipFile(): Promise<File | null>;
  getAuthToken(): string | null;
  setAuthToken(token: string): void;
  clearAuthToken(): void;
}

interface Window {
  __zipship_desktop?: ZipShipDesktopAPI;
}
