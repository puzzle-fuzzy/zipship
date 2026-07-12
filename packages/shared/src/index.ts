export const ZIPSHIP_RESERVED_SLUGS = [
  "_api",
  "_console",
  "_health",
  "_assets",
  "favicon.ico",
  "robots.txt",
] as const;

/**
 * Single source of truth for the role / status enums shared between the db
 * (Drizzle pgEnums) and the api / frontend (union types). The db pgEnums
 * spread these arrays (see packages/db/src/schema.ts) so the two definitions
 * can't drift apart.
 */
export const MEMBER_ROLES = [
  "owner",
  "admin",
  "developer",
  "deployer",
  "viewer",
] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

export const RELEASE_STATUSES = [
  "uploading",
  "processing",
  "ready",
  "active",
  "failed",
  "archived",
  "deleted",
] as const;
export type ReleaseStatus = (typeof RELEASE_STATUSES)[number];

export const DEPLOYMENT_ACTIONS = [
  "publish",
  "rollback",
  "promote",
  "archive",
] as const;
export type DeploymentAction = (typeof DEPLOYMENT_ACTIONS)[number];

export const ACCESS_PLANE_CACHE_POLICIES = ["standard", "aggressive"] as const;
export type AccessPlaneCachePolicy = (typeof ACCESS_PLANE_CACHE_POLICIES)[number];

export interface AccessPlaneProjectSettings {
  slug: string;
  spaFallback: boolean;
  cachePolicy: AccessPlaneCachePolicy;
  customDomains: string[];
}

export interface AccessPlanePreview {
  liveLocation: string;
  pinnedLocation: string;
  spaFallbackTarget: string;
  missingAssetBehavior: "index" | "404";
  htmlCacheControl: string;
  assetCacheControl: string;
  customDomains: string[];
  warnings: AccessPlaneWarning[];
}

export interface AccessPlaneWarning {
  code: "CUSTOM_DOMAINS_NOT_APPLIED" | "AGGRESSIVE_CACHE_REQUIRES_IMMUTABLE_ASSETS";
  severity: "info" | "warning";
}

export interface NginxAccessPlaneSnippet {
  slug: string;
  config: string;
  warnings: AccessPlaneWarning[];
}

export interface NginxAccessPlaneRenderOptions {
  sitesRoot?: string;
}

export function buildAccessPlanePreview(
  settings: AccessPlaneProjectSettings,
): AccessPlanePreview {
  const normalizedDomains = normalizeAccessPlaneDomains(settings.customDomains);
  const htmlCacheControl = "no-cache";
  const assetCacheControl =
    settings.cachePolicy === "aggressive"
      ? "public, max-age=31536000, immutable"
      : "public, max-age=3600";

  return {
    liveLocation: `/${settings.slug}/`,
    pinnedLocation: `/${settings.slug}/{releaseHash}/`,
    spaFallbackTarget: settings.spaFallback ? "index.html" : "404",
    missingAssetBehavior: settings.spaFallback ? "index" : "404",
    htmlCacheControl,
    assetCacheControl,
    customDomains: normalizedDomains,
    warnings: buildAccessPlaneWarnings(settings.cachePolicy, normalizedDomains),
  };
}

export function normalizeAccessPlaneDomains(domains: string[]): string[] {
  return Array.from(
    new Set(
      domains
        .map((domain) => domain.trim().toLowerCase())
        .filter(Boolean),
    ),
  );
}

export function buildNginxProjectAccessSnippet(
  settings: AccessPlaneProjectSettings,
  options: NginxAccessPlaneRenderOptions = {},
): NginxAccessPlaneSnippet {
  assertValidAccessPlaneSlug(settings.slug);

  const preview = buildAccessPlanePreview(settings);
  const sitesRoot = options.sitesRoot ?? "${ZIPSHIP_SITES_ROOT}";
  const namedLocationSlug = settings.slug.replaceAll("-", "_");
  const releaseFallback = `@zipship_${namedLocationSlug}_release_spa`;
  const currentFallback = `@zipship_${namedLocationSlug}_current_spa`;
  const releaseTryFiles = settings.spaFallback
    ? `try_files /${settings.slug}/releases/$zipship_release_hash/$2 ${releaseFallback};`
    : `try_files /${settings.slug}/releases/$zipship_release_hash/$2 =404;`;
  const currentTryFiles = settings.spaFallback
    ? `try_files /${settings.slug}/current/$1 ${currentFallback};`
    : `try_files /${settings.slug}/current/$1 =404;`;
  const fallbackLocations = settings.spaFallback
    ? [
        "",
        `  location ${releaseFallback} {`,
        `    root ${sitesRoot};`,
        `    try_files /${settings.slug}/releases/$zipship_release_hash/index.html =404;`,
        `    add_header Cache-Control "${preview.htmlCacheControl}";`,
        "  }",
        "",
        `  location ${currentFallback} {`,
        `    root ${sitesRoot};`,
        `    try_files /${settings.slug}/current/index.html =404;`,
        `    add_header Cache-Control "${preview.htmlCacheControl}";`,
        "  }",
      ]
    : [];

  return {
    slug: settings.slug,
    warnings: preview.warnings,
    config: [
      `  # ZipShip project access policy: ${settings.slug}`,
      `  location = /${settings.slug} {`,
      `    return 308 /${settings.slug}/;`,
      "  }",
      "",
      `  location ~ ^/${settings.slug}/([a-f0-9]{12})$ {`,
      `    return 308 /${settings.slug}/$1/;`,
      "  }",
      "",
      `  location = /${settings.slug}/ {`,
      `    root ${sitesRoot};`,
      `    try_files /${settings.slug}/current/index.html =404;`,
      `    add_header Cache-Control "${preview.htmlCacheControl}";`,
      "  }",
      "",
      `  location ~ ^/${settings.slug}/([a-f0-9]{12})/$ {`,
      "    set $zipship_release_hash $1;",
      `    root ${sitesRoot};`,
      `    try_files /${settings.slug}/releases/$zipship_release_hash/index.html =404;`,
      `    add_header Cache-Control "${preview.htmlCacheControl}";`,
      "  }",
      "",
      `  location ~ ^/${settings.slug}/([a-f0-9]{12})/(.+)$ {`,
      "    set $zipship_release_hash $1;",
      `    root ${sitesRoot};`,
      `    ${releaseTryFiles}`,
      `    add_header Cache-Control "${preview.assetCacheControl}";`,
      "  }",
      "",
      `  location ~ ^/${settings.slug}/(.+)$ {`,
      `    root ${sitesRoot};`,
      `    ${currentTryFiles}`,
      `    add_header Cache-Control "${preview.assetCacheControl}";`,
      "  }",
      ...fallbackLocations,
    ].join("\n"),
  };
}

function assertValidAccessPlaneSlug(slug: string) {
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(slug)) {
    throw new Error(`Invalid access-plane slug: ${slug}`);
  }
}

function buildAccessPlaneWarnings(
  cachePolicy: AccessPlaneCachePolicy,
  customDomains: string[],
): AccessPlaneWarning[] {
  const warnings: AccessPlaneWarning[] = [];

  if (customDomains.length > 0) {
    warnings.push({ code: "CUSTOM_DOMAINS_NOT_APPLIED", severity: "info" });
  }

  if (cachePolicy === "aggressive") {
    warnings.push({
      code: "AGGRESSIVE_CACHE_REQUIRES_IMMUTABLE_ASSETS",
      severity: "warning",
    });
  }

  return warnings;
}
