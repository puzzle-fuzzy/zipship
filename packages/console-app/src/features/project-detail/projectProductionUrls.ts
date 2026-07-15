export function buildProductionUrls(
  accessBaseUrl: string,
  projectSlug: string,
  releaseId: string,
) {
  const origin = accessBaseUrl.replace(/\/+$/, "");
  return {
    liveUrl: `${origin}/${projectSlug}/`,
    pinnedUrl: `${origin}/_sites/${projectSlug}/${releaseId}/`,
  };
}
