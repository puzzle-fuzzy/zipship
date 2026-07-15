export function buildProductionUrls(projectSlug: string, releaseHash: string) {
  const origin =
    typeof window === "undefined" || !window.location?.origin
      ? ""
      : window.location.origin.replace(/\/+$/, "");

  return {
    liveUrl: `${origin}/${projectSlug}/`,
    pinnedUrl: `${origin}/${projectSlug}/${releaseHash}/`,
  };
}
