// packages/deploy-core/src/root.ts

import { join } from "path";
import type { FileEntry } from "./types";

interface RootResult {
  rootDir: string;
  files: FileEntry[];
}

/**
 * Detect the actual artifact root directory.
 *
 * Many users zip with a single top-level directory (e.g., dist/).
 * This function detects that case and re-roots paths accordingly.
 */
export function resolveArtifactRoot(files: FileEntry[], workDir: string): RootResult {
  if (files.length === 0) {
    return { rootDir: workDir, files: [] };
  }

  // Check if index.html exists at root
  const hasRootIndex = files.some((f) => f.path === "index.html");
  if (hasRootIndex) {
    return { rootDir: workDir, files };
  }

  // Find all top-level directories
  const topLevelDirs = new Set<string>();
  for (const f of files) {
    const firstSlash = f.path.indexOf("/");
    if (firstSlash > 0) {
      topLevelDirs.add(f.path.slice(0, firstSlash));
    }
  }

  // If exactly one top-level dir, check if it contains index.html
  if (topLevelDirs.size === 1) {
    const topDir = [...topLevelDirs][0];
    const prefix = topDir + "/";
    const dirFiles = files.filter((f) => f.path.startsWith(prefix));

    if (dirFiles.some((f) => f.path === prefix + "index.html")) {
      // Re-root: strip the top-level directory from paths
      const reRootedFiles = dirFiles.map((f) => ({
        ...f,
        path: f.path.slice(prefix.length),
      }));
      return { rootDir: join(workDir, topDir), files: reRootedFiles };
    }

    // Try recursive descent: single dir all the way down
    const nestedFiles = files.filter((f) => f.path.startsWith(prefix));
    if (nestedFiles.length === files.length) {
      const deeper = resolveArtifactRoot(
        nestedFiles.map((f) => ({ ...f, path: f.path.slice(prefix.length) })),
        join(workDir, topDir),
      );
      if (deeper.rootDir !== join(workDir, topDir) || nestedFiles.some((f) => f.path === prefix + "index.html")) {
        return deeper;
      }
    }
  }

  // Cannot determine root — return workDir unchanged
  return { rootDir: workDir, files };
}
