// packages/deploy-core/src/limits.ts

import type { ReleaseLimits } from "./types";

export const DEFAULT_RELEASE_LIMITS: ReleaseLimits = {
  maxFiles: 10_000,
  maxSingleFileSize: 100 * 1024 * 1024,
  maxTotalUncompressedSize: 512 * 1024 * 1024,
  maxIndexHtmlAnalyzeSize: 512 * 1024,
  maxCssAnalyzeSize: 1 * 1024 * 1024,
};

export function resolveReleaseLimits(partial?: Partial<ReleaseLimits>): ReleaseLimits {
  if (!partial) return { ...DEFAULT_RELEASE_LIMITS };
  return {
    maxFiles: partial.maxFiles ?? DEFAULT_RELEASE_LIMITS.maxFiles,
    maxSingleFileSize: partial.maxSingleFileSize ?? DEFAULT_RELEASE_LIMITS.maxSingleFileSize,
    maxTotalUncompressedSize: partial.maxTotalUncompressedSize ?? DEFAULT_RELEASE_LIMITS.maxTotalUncompressedSize,
    maxIndexHtmlAnalyzeSize: partial.maxIndexHtmlAnalyzeSize ?? DEFAULT_RELEASE_LIMITS.maxIndexHtmlAnalyzeSize,
    maxCssAnalyzeSize: partial.maxCssAnalyzeSize ?? DEFAULT_RELEASE_LIMITS.maxCssAnalyzeSize,
  };
}
