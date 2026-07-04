export interface RuntimeAdapter {
  kind: "web" | "desktop";
  openExternal(url: string): Promise<void>;
}

export function createWebRuntime(): RuntimeAdapter {
  return {
    kind: "web",
    async openExternal(url) {
      window.open(url, "_blank", "noopener,noreferrer");
    },
  };
}
