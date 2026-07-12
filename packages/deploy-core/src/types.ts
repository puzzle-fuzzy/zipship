// packages/deploy-core/src/types.ts

export interface ReleaseLimits {
  maxFiles: number;
  maxSingleFileSize: number;
  maxTotalUncompressedSize: number;
  maxIndexHtmlAnalyzeSize: number;
  maxCssAnalyzeSize: number;
}

export interface FileEntry {
  path: string;
  absPath: string;
  size: number;
  hash?: string;
}

export interface DetectItem {
  level: "info" | "warning" | "failed";
  code: string;
  details?: Record<string, unknown>;
}

export interface DetectResult {
  level: "pass" | "warning" | "failed";
  items: DetectItem[];
  insights?: ArtifactInsights;
}

export interface ArtifactAssetTypeSummary {
  count: number;
  totalSize: number;
}

export interface ArtifactAssetSummary {
  totalFiles: number;
  totalSize: number;
  byType: {
    html: ArtifactAssetTypeSummary;
    javascript: ArtifactAssetTypeSummary;
    css: ArtifactAssetTypeSummary;
    images: ArtifactAssetTypeSummary;
    fonts: ArtifactAssetTypeSummary;
    maps: ArtifactAssetTypeSummary;
    other: ArtifactAssetTypeSummary;
  };
  largestFiles: Array<{
    path: string;
    size: number;
  }>;
}

export interface ArtifactHtmlMetadata {
  title: string | null;
  description: string | null;
  hasViewport: boolean;
  hasCanonical: boolean;
  hasOpenGraph: boolean;
  hasTwitterCard: boolean;
  hasFavicon: boolean;
  lang: string | null;
}

export interface ArtifactSeoCheck {
  code: string;
  status: "pass" | "warning";
  details?: Record<string, unknown>;
}

export interface ArtifactSeoSummary {
  score: number;
  checks: ArtifactSeoCheck[];
}

export interface ArtifactInsights {
  entrypoint: string | null;
  assets: ArtifactAssetSummary;
  html: ArtifactHtmlMetadata;
  seo: ArtifactSeoSummary;
}

export interface ManifestEntry {
  path: string;
  hash: string;
  size: number;
}

export interface Manifest {
  version: number;
  hashAlgorithm: string;
  files: ManifestEntry[];
  hash: string;
  releaseHash: string;
}

export interface ReleaseResult {
  rootDir: string;
  files: FileEntry[];
  detect: DetectResult;
  manifest: Manifest;
}

export type DetectMode = "auto" | "vite" | "static";

export interface ProcessReleaseOptions {
  zipPath: string;
  workDir: string;
  limits?: Partial<ReleaseLimits>;
  detectMode?: DetectMode;
}
