export interface RuntimeAdapter {
  kind: "web" | "desktop";
  openExternal(url: string): Promise<void>;
}

export type NativeExternalOpener = (url: string) => Promise<void>;

export function createWebRuntime(): RuntimeAdapter {
  return {
    kind: "web",
    async openExternal(url) {
      window.open(validateExternalUrl(url), "_blank", "noopener,noreferrer");
    },
  };
}

export function createDesktopRuntime(openUrl: NativeExternalOpener): RuntimeAdapter {
  return {
    kind: "desktop",
    async openExternal(url) {
      await openUrl(validateExternalUrl(url));
    },
  };
}

function validateExternalUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("External URL must use HTTP or HTTPS without credentials");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username.length > 0 ||
    url.password.length > 0
  ) {
    throw new Error("External URL must use HTTP or HTTPS without credentials");
  }
  return url.toString();
}
