import { cp, mkdir, realpath, rm, stat } from "fs/promises";
import { dirname, extname, join, resolve, sep } from "path";

export interface StoragePaths {
  uploadsRoot: string;
  tempRoot: string;
  sitesRoot: string;
}

export function createStoragePaths(root: string): StoragePaths {
  return {
    uploadsRoot: join(root, "uploads"),
    tempRoot: join(root, "temp"),
    sitesRoot: join(root, "sites"),
  };
}

export function createUploadRawPath(
  paths: StoragePaths,
  input: {
    projectId: string;
    uploadTaskId: string;
    filename: string;
  },
): string {
  return join(paths.uploadsRoot, "raw", input.projectId, input.uploadTaskId, input.filename);
}

export function createUploadWorkDir(paths: StoragePaths, uploadTaskId: string): string {
  return join(paths.tempRoot, uploadTaskId);
}

export function createReleaseStoragePath(
  paths: StoragePaths,
  input: {
    projectId: string;
    releaseHash: string;
  },
): string {
  return join(paths.sitesRoot, input.projectId, "releases", input.releaseHash);
}

export async function writeFileToPath(file: File, absolutePath: string): Promise<{ size: number }> {
  await mkdir(dirname(absolutePath), { recursive: true });
  await Bun.write(absolutePath, file);

  return {
    size: file.size,
  };
}

export async function copyDirectoryContents(sourceDir: string, destinationDir: string): Promise<void> {
  await rm(destinationDir, { recursive: true, force: true });
  await mkdir(dirname(destinationDir), { recursive: true });
  await cp(sourceDir, destinationDir, {
    recursive: true,
    force: true,
    errorOnExist: false,
  });
}

export type StaticAssetResolution =
  | {
      kind: "file";
      absolutePath: string;
    }
  | {
      kind: "not-found";
    };

export async function resolveStaticAssetPath(input: {
  rootDir: string;
  requestPath: string;
}): Promise<StaticAssetResolution> {
  const root = resolve(input.rootDir);

  let resolvedRoot: string;
  try {
    resolvedRoot = await realpath(root);
  } catch {
    return { kind: "not-found" };
  }

  const decodedPath = safeDecodePath(input.requestPath);

  if (decodedPath === null || isDangerousStaticPath(decodedPath)) {
    return { kind: "not-found" };
  }

  const cleanPath = decodedPath.replace(/^\/+/, "");
  const candidate = resolve(resolvedRoot, cleanPath || "index.html");

  let resolvedCandidate: string;
  try {
    resolvedCandidate = await realpath(candidate);
  } catch {
    // Path does not exist — no symlink to traverse; stay with resolved path
    resolvedCandidate = candidate;
  }

  if (!isPathInside(resolvedRoot, resolvedCandidate)) {
    return { kind: "not-found" };
  }

  const filePath = await resolveFileOrFallback(resolvedRoot, resolvedCandidate);

  if (!filePath) return { kind: "not-found" };

  return {
    kind: "file",
    absolutePath: filePath,
  };
}

export function contentTypeForPath(absolutePath: string): string {
  switch (extname(absolutePath).toLowerCase()) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".ico":
      return "image/x-icon";
    default:
      return "application/octet-stream";
  }
}

function safeDecodePath(requestPath: string): string | null {
  try {
    let prev = requestPath;
    for (let i = 0; i < 5; i++) {
      const decoded = decodeURIComponent(prev);
      if (decoded === prev) break;
      prev = decoded;
    }
    return prev;
  } catch {
    return null;
  }
}

function isDangerousStaticPath(requestPath: string): boolean {
  if (requestPath.includes("\0")) return true;
  if (requestPath.includes("\\")) return true;
  if (requestPath.startsWith("/")) return true;
  if (/^[a-zA-Z]:/.test(requestPath)) return true;

  return requestPath.split("/").some((part) => part === "..");
}

function isPathInside(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(root.endsWith(sep) ? root : root + sep);
}

async function resolveFileOrFallback(root: string, candidate: string): Promise<string | null> {
  const candidateFile = await statFile(candidate);

  if (candidateFile === "file") return candidate;
  if (candidateFile === "directory") {
    const indexPath = resolve(candidate, "index.html");
    return (await statFile(indexPath)) === "file" && isPathInside(root, indexPath) ? indexPath : null;
  }

  const fallback = resolve(root, "index.html");
  return (await statFile(fallback)) === "file" ? fallback : null;
}

async function statFile(absolutePath: string): Promise<"file" | "directory" | "missing"> {
  try {
    const result = await stat(absolutePath);
    if (result.isFile()) return "file";
    if (result.isDirectory()) return "directory";
    return "missing";
  } catch {
    return "missing";
  }
}
