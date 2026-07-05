// packages/deploy-core/src/index.ts

import { ZIPSHIP_RESERVED_SLUGS } from "@zipship/shared";
import { safeExtractZip } from "./unzip";
import { resolveArtifactRoot } from "./root";
import { runDetection } from "./detect";
import { buildManifest } from "./manifest";
import type { ProcessReleaseOptions, ReleaseResult } from "./types";
import { resolveReleaseLimits } from "./limits";

export { safeExtractZip } from "./unzip";
export { resolveArtifactRoot } from "./root";
export { runDetection } from "./detect";
export { buildManifest } from "./manifest";
export { hashFile, deriveReleaseHash } from "./hash";
export { DeployCoreError, DEPLOY_CORE_ERROR_CODES } from "./errors";
export { DEFAULT_RELEASE_LIMITS, resolveReleaseLimits } from "./limits";
export type * from "./types";

const slugPattern = /^[a-z0-9][a-z0-9_-]*$/;

export function isValidProjectSlug(slug: string): boolean {
  return slugPattern.test(slug) && !ZIPSHIP_RESERVED_SLUGS.includes(slug as never);
}

export async function processRelease(options: ProcessReleaseOptions): Promise<ReleaseResult> {
  const limits = resolveReleaseLimits(options.limits);

  const extractedFiles = await safeExtractZip(options.zipPath, options.workDir, limits);

  const { rootDir, files } = resolveArtifactRoot(extractedFiles, options.workDir);

  const detect = await runDetection(files, {
    detectMode: options.detectMode ?? "auto",
    maxIndexHtmlAnalyzeSize: limits.maxIndexHtmlAnalyzeSize,
    maxCssAnalyzeSize: limits.maxCssAnalyzeSize,
  });

  const manifest = await buildManifest(files);

  return {
    rootDir,
    files,
    detect,
    manifest,
  };
}
