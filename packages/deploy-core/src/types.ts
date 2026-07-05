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
