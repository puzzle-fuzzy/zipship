import { chmodSync, createWriteStream, mkdirSync } from "fs";
import { join, resolve } from "path";
import yauzl from "yauzl";
import { normalizeZipEntryPath } from "./path";
import { DeployCoreError, DEPLOY_CORE_ERROR_CODES } from "./errors";
import { resolveReleaseLimits } from "./limits";
import type { FileEntry, ReleaseLimits } from "./types";

/**
 * Safely extract a zip file to a working directory.
 *
 * Uses yauzl lazyEntries mode to process entries one at a time,
 * validating each entry for security before writing to disk.
 */
export async function safeExtractZip(
  zipPath: string,
  workDir: string,
  limits?: Partial<ReleaseLimits>,
): Promise<FileEntry[]> {
  const resolvedLimits = resolveReleaseLimits(limits);
  const entries: FileEntry[] = [];
  const seenPaths = new Set<string>();
  let totalUncompressedSize = 0;

  await new Promise<void>((resolvePromise, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zipfile) => {
      if (err) {
        reject(new DeployCoreError(DEPLOY_CORE_ERROR_CODES.ZIP_OPEN_FAILED, { zipPath, error: err.message }));
        return;
      }
      if (!zipfile) {
        reject(new DeployCoreError(DEPLOY_CORE_ERROR_CODES.ZIP_OPEN_FAILED, { zipPath }));
        return;
      }

      zipfile.readEntry();

      zipfile.on("entry", (entry: yauzl.Entry) => {
        try {
          // Normalize and validate the path
          const normalizedPath = normalizeZipEntryPath(entry.fileName);

          // Skip directory entries
          if (/\/$/.test(normalizedPath)) {
            mkdirSync(join(workDir, normalizedPath), { recursive: true });
            zipfile.readEntry();
            return;
          }

          // Check for duplicate normalized paths
          if (seenPaths.has(normalizedPath)) {
            reject(new DeployCoreError(DEPLOY_CORE_ERROR_CODES.ZIP_ENTRY_DUPLICATE_PATH, {
              fileName: entry.fileName,
              normalizedPath,
            }));
            return;
          }

          // Check file count
          if (entries.length >= resolvedLimits.maxFiles) {
            reject(new DeployCoreError(DEPLOY_CORE_ERROR_CODES.ZIP_TOO_MANY_FILES, {
              maxFiles: resolvedLimits.maxFiles,
            }));
            return;
          }

          // Check uncompressed size
          const uncompressedSize = Number(entry.uncompressedSize);
          totalUncompressedSize += uncompressedSize;

          if (totalUncompressedSize > resolvedLimits.maxTotalUncompressedSize) {
            reject(new DeployCoreError(DEPLOY_CORE_ERROR_CODES.ZIP_TOTAL_SIZE_TOO_LARGE, {
              maxTotal: resolvedLimits.maxTotalUncompressedSize,
              actual: totalUncompressedSize,
            }));
            return;
          }

          // Check single file size
          if (uncompressedSize > resolvedLimits.maxSingleFileSize) {
            reject(new DeployCoreError(DEPLOY_CORE_ERROR_CODES.ZIP_SINGLE_FILE_TOO_LARGE, {
              fileName: entry.fileName,
              size: uncompressedSize,
              maxSize: resolvedLimits.maxSingleFileSize,
            }));
            return;
          }

          // External file attributes: check if symlink (Unix symlink = 0o120000 mask)
          const externalAttr = entry.externalFileAttributes;
          const isUnixSymlink = (externalAttr !== undefined) && ((externalAttr >>> 16) & 0o170000) === 0o120000;
          if (isUnixSymlink) {
            reject(new DeployCoreError(DEPLOY_CORE_ERROR_CODES.ZIP_ENTRY_SYMLINK, {
              fileName: entry.fileName,
            }));
            return;
          }

          seenPaths.add(normalizedPath);

          // Open read stream for this entry
          zipfile.openReadStream(entry, (readErr, readStream) => {
            if (readErr || !readStream) {
              reject(new DeployCoreError(DEPLOY_CORE_ERROR_CODES.ZIP_EXTRACT_FAILED, {
                fileName: entry.fileName,
                error: readErr?.message,
              }));
              return;
            }

            const targetDir = resolve(workDir, normalizedPath);
            // Verify the resolved path is within workDir
            if (!targetDir.startsWith(resolve(workDir))) {
              reject(new DeployCoreError(DEPLOY_CORE_ERROR_CODES.ZIP_ENTRY_PATH_TRAVERSAL, {
                fileName: entry.fileName,
                normalizedPath,
              }));
              return;
            }

            mkdirSync(join(targetDir, ".."), { recursive: true });

            const writeStream = createWriteStream(targetDir);

            readStream.pipe(writeStream);

            writeStream.on("finish", () => {
              // Set secure file permissions — don't inherit zip entry's Unix bits
              chmodSync(targetDir, 0o644);
              entries.push({
                path: normalizedPath,
                absPath: targetDir,
                size: uncompressedSize,
              });
              zipfile.readEntry();
            });

            writeStream.on("error", (writeErr) => {
              reject(new DeployCoreError(DEPLOY_CORE_ERROR_CODES.ZIP_EXTRACT_FAILED, {
                fileName: entry.fileName,
                error: writeErr.message,
              }));
            });
          });
        } catch (normalizeErr) {
          if (normalizeErr instanceof DeployCoreError) {
            reject(normalizeErr);
          } else {
            reject(new DeployCoreError(DEPLOY_CORE_ERROR_CODES.ZIP_EXTRACT_FAILED, {
              fileName: entry.fileName,
              error: String(normalizeErr),
            }));
          }
        }
      });

      zipfile.on("end", () => {
        resolvePromise();
      });

      zipfile.on("error", (zipErr) => {
        const msg = zipErr.message;
        // yauzl v3's validateFileName rejects entries before our handler sees them.
        // Translate yauzl error messages to the correct DeployCoreError codes.
        if (msg.startsWith("absolute path:")) {
          reject(new DeployCoreError(DEPLOY_CORE_ERROR_CODES.ZIP_ENTRY_ABSOLUTE_PATH, {
            error: msg,
          }));
        } else if (msg.startsWith("invalid relative path:")) {
          reject(new DeployCoreError(DEPLOY_CORE_ERROR_CODES.ZIP_ENTRY_PATH_TRAVERSAL, {
            error: msg,
          }));
        } else {
          reject(new DeployCoreError(DEPLOY_CORE_ERROR_CODES.ZIP_EXTRACT_FAILED, {
            error: msg,
          }));
        }
      });
    });
  });

  return entries;
}
