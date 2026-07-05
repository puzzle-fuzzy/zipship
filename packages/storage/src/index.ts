import { mkdir } from "fs/promises";
import { dirname, join } from "path";

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
