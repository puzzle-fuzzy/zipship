export function buildSitePreviewUrl(apiBaseUrl: string, projectSlug: string, releaseHash: string) {
  const base = apiBaseUrl.replace(/\/+$/, "");
  return `${base}/_sites/${projectSlug}/${releaseHash}/`;
}
