import type { Release } from "../../stores/projectsStore";

export type AccessPlaneCachePolicy = "standard" | "aggressive";

export interface AccessPlanePolicyPreview {
  missingAssetBehavior: "index" | "404";
  htmlCacheControl: string;
  assetCacheControl: string;
  warnings: Array<{
    code: "AGGRESSIVE_CACHE_REQUIRES_IMMUTABLE_ASSETS";
    severity: "warning";
  }>;
}

export function buildProjectProductionPaths(
  projectSlug: string,
  activeRelease: Pick<Release, "id"> | undefined,
) {
  return {
    livePath: `/${projectSlug}/`,
    pinnedPath: activeRelease ? `/_sites/${projectSlug}/${activeRelease.id}/` : null,
  };
}

export function buildAccessPlanePolicyPreview(settings: {
  spaFallback: boolean;
  cachePolicy: AccessPlaneCachePolicy;
}): AccessPlanePolicyPreview {
  return {
    missingAssetBehavior: settings.spaFallback ? "index" : "404",
    htmlCacheControl: "no-cache",
    assetCacheControl:
      settings.cachePolicy === "aggressive"
        ? "public, max-age=31536000, immutable"
        : "public, max-age=3600",
    warnings:
      settings.cachePolicy === "aggressive"
        ? [
            {
              code: "AGGRESSIVE_CACHE_REQUIRES_IMMUTABLE_ASSETS",
              severity: "warning",
            },
          ]
        : [],
  };
}
