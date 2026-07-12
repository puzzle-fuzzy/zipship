import { describe, expect, test } from "bun:test";
import {
  buildAccessPlanePreview,
  buildNginxProjectAccessSnippet,
  normalizeAccessPlaneDomains,
} from "../src";

describe("access plane preview", () => {
  test("builds standard cache and spa fallback behavior", () => {
    const preview = buildAccessPlanePreview({
      slug: "marketing",
      spaFallback: true,
      cachePolicy: "standard",
      customDomains: [],
    });

    expect(preview).toMatchObject({
      liveLocation: "/marketing/",
      pinnedLocation: "/marketing/{releaseHash}/",
      spaFallbackTarget: "index.html",
      missingAssetBehavior: "index",
      htmlCacheControl: "no-cache",
      assetCacheControl: "public, max-age=3600",
      warnings: [],
    });
  });

  test("normalizes domains and reports pending access-plane warnings", () => {
    const preview = buildAccessPlanePreview({
      slug: "docs",
      spaFallback: false,
      cachePolicy: "aggressive",
      customDomains: ["WWW.Example.COM", "www.example.com", "docs.example.com"],
    });

    expect(preview.customDomains).toEqual(["www.example.com", "docs.example.com"]);
    expect(preview.missingAssetBehavior).toBe("404");
    expect(preview.assetCacheControl).toBe("public, max-age=31536000, immutable");
    expect(preview.warnings).toEqual([
      { code: "CUSTOM_DOMAINS_NOT_APPLIED", severity: "info" },
      { code: "AGGRESSIVE_CACHE_REQUIRES_IMMUTABLE_ASSETS", severity: "warning" },
    ]);
  });

  test("normalizes custom domains", () => {
    expect(normalizeAccessPlaneDomains([" App.EXAMPLE.com ", "", "app.example.com"])).toEqual([
      "app.example.com",
    ]);
  });

  test("builds nginx snippet for project-specific spa fallback and aggressive cache", () => {
    const snippet = buildNginxProjectAccessSnippet({
      slug: "docs-site",
      spaFallback: true,
      cachePolicy: "aggressive",
      customDomains: ["docs.example.com"],
    });

    expect(snippet.config).toContain("location = /docs-site");
    expect(snippet.config).toContain("return 308 /docs-site/;");
    expect(snippet.config).toContain("location ~ ^/docs-site/([a-f0-9]{12})/(.+)$");
    expect(snippet.config).toContain(
      "try_files /docs-site/releases/$zipship_release_hash/$2 @zipship_docs_site_release_spa;",
    );
    expect(snippet.config).toContain(
      'add_header Cache-Control "public, max-age=31536000, immutable";',
    );
    expect(snippet.config).toContain("location @zipship_docs_site_current_spa");
    expect(snippet.warnings.map((warning) => warning.code)).toEqual([
      "CUSTOM_DOMAINS_NOT_APPLIED",
      "AGGRESSIVE_CACHE_REQUIRES_IMMUTABLE_ASSETS",
    ]);
  });

  test("builds nginx snippet that disables spa fallback", () => {
    const snippet = buildNginxProjectAccessSnippet(
      {
        slug: "landing",
        spaFallback: false,
        cachePolicy: "standard",
        customDomains: [],
      },
      { sitesRoot: "/var/lib/zipship/sites" },
    );

    expect(snippet.config).toContain("root /var/lib/zipship/sites;");
    expect(snippet.config).toContain("try_files /landing/current/$1 =404;");
    expect(snippet.config).toContain(
      "try_files /landing/releases/$zipship_release_hash/$2 =404;",
    );
    expect(snippet.config).toContain('add_header Cache-Control "public, max-age=3600";');
    expect(snippet.config).not.toContain("@zipship_landing_current_spa");
    expect(snippet.warnings).toEqual([]);
  });

  test("rejects invalid nginx slugs", () => {
    expect(() =>
      buildNginxProjectAccessSnippet({
        slug: "../bad",
        spaFallback: true,
        cachePolicy: "standard",
        customDomains: [],
      }),
    ).toThrow("Invalid access-plane slug");
  });
});
