/**
 * StorageAdapter — the IO contract for artifact storage.
 *
 * The local implementation uses the filesystem, including a symlinked `current`
 * pointer for zero-downtime release switching (see {@link switchCurrentReleaseLink}).
 * S3/MinIO can't satisfy that symlink strategy directly (object stores have no
 * symlinks), so a future S3 adapter would model "current" as a metadata pointer
 * (e.g. a small object mapping slug → active hash) rather than a symlink. That
 * is the design decision required to fully land TODO 4.1; this interface
 * captures the IO operations that abstract cleanly across backends.
 */
import {
  mkdir,
  readFile as fsReadFile,
  rm,
  stat as fsStat,
  writeFile as fsWriteFile,
} from "fs/promises";

export interface StorageAdapter {
  writeFile(path: string, data: Uint8Array | string): Promise<void>;
  readFile(path: string): Promise<Uint8Array>;
  /** Classify a path; `missing` covers "does not exist". */
  stat(path: string): Promise<{ kind: "file" | "directory" | "missing" }>;
  ensureDir(path: string): Promise<void>;
  remove(path: string): Promise<void>;
}

/** Filesystem-backed adapter. Drop-in target for an S3 adapter later. */
export class LocalStorageAdapter implements StorageAdapter {
  async writeFile(path: string, data: Uint8Array | string): Promise<void> {
    await fsWriteFile(path, data);
  }

  async readFile(path: string): Promise<Uint8Array> {
    return fsReadFile(path);
  }

  async stat(path: string): Promise<{ kind: "file" | "directory" | "missing" }> {
    try {
      const s = await fsStat(path);
      if (s.isDirectory()) return { kind: "directory" };
      if (s.isFile()) return { kind: "file" };
      return { kind: "missing" };
    } catch {
      return { kind: "missing" };
    }
  }

  async ensureDir(path: string): Promise<void> {
    await mkdir(path, { recursive: true });
  }

  async remove(path: string): Promise<void> {
    await rm(path, { force: true, recursive: true });
  }
}
