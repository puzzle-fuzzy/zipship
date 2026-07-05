// packages/deploy-core/src/path.ts

import { DeployCoreError, DEPLOY_CORE_ERROR_CODES } from "./errors";

const WINDOWS_DRIVE_PATH = /^[a-zA-Z]:[/\\]/;
const NUL_BYTE = /\0/;

/**
 * Normalize and validate a zip entry path.
 *
 * Rules:
 * 1. Replace backslashes with forward slashes
 * 2. Reject empty paths
 * 3. Reject NUL byte
 * 4. Reject absolute paths (starting with /)
 * 5. Reject //server/share paths
 * 6. Reject Windows drive paths (C:\...)
 * 7. Reject any .. path segments
 * 8. Remove leading ./
 * 9. Collapse duplicate /
 * 10. Decode percent-encoded characters
 */
export function normalizeZipEntryPath(entryName: string): string {
  if (!entryName) {
    throw new DeployCoreError(DEPLOY_CORE_ERROR_CODES.ZIP_ENTRY_NUL_BYTE, { entryName });
  }

  if (NUL_BYTE.test(entryName)) {
    throw new DeployCoreError(DEPLOY_CORE_ERROR_CODES.ZIP_ENTRY_NUL_BYTE, { entryName });
  }

  // Normalize backslashes
  let normalized = entryName.replace(/\\/g, "/");

  // Decode percent-encoded characters (except for when it's actually a %)
  try {
    normalized = decodeURIComponent(normalized);
  } catch {
    // If decoding fails, use the original normalized string
  }

  // Re-check for NUL byte after decoding (e.g., %00 decodes to \x00)
  if (NUL_BYTE.test(normalized)) {
    throw new DeployCoreError(DEPLOY_CORE_ERROR_CODES.ZIP_ENTRY_NUL_BYTE, { entryName });
  }

  // Reject absolute Unix paths
  if (normalized.startsWith("/")) {
    throw new DeployCoreError(DEPLOY_CORE_ERROR_CODES.ZIP_ENTRY_ABSOLUTE_PATH, { entryName, normalized });
  }

  // Reject //server/share paths
  if (normalized.startsWith("//")) {
    throw new DeployCoreError(DEPLOY_CORE_ERROR_CODES.ZIP_ENTRY_ABSOLUTE_PATH, { entryName, normalized });
  }

  // Reject Windows drive paths
  if (WINDOWS_DRIVE_PATH.test(normalized)) {
    throw new DeployCoreError(DEPLOY_CORE_ERROR_CODES.ZIP_ENTRY_WINDOWS_DRIVE_PATH, { entryName, normalized });
  }

  // Collapse duplicate slashes
  normalized = normalized.replace(/\/+/g, "/");

  // Remove leading ./
  normalized = normalized.replace(/^\.\//, "");

  // Reject any path traversal (.. segments)
  const segments = normalized.split("/");
  for (const segment of segments) {
    if (segment === "..") {
      throw new DeployCoreError(DEPLOY_CORE_ERROR_CODES.ZIP_ENTRY_PATH_TRAVERSAL, { entryName, normalized });
    }
  }

  return normalized;
}
