export function buildSitePreviewUrl(
  accessBaseUrl: string,
  projectSlug: string,
  releaseId: string,
) {
  const base = accessBaseUrl.replace(/\/+$/, "");
  return `${base}/_sites/${projectSlug}/${releaseId}/`;
}
