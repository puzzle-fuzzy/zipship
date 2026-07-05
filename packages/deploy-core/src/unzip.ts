import { chmodSync, createWriteStream, mkdirSync } from "fs";
import { join, resolve, sep } from "path";
import type { Readable } from "stream";
import type { WriteStream } from "fs";
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
    let settled = false;
    let zipfileRef: yauzl.ZipFile | null = null;
    let activeReadStream: Readable | null = null;
    let activeWriteStream: WriteStream | null = null;

    const fail = (error: DeployCoreError) => {
      if (settled) return;

      settled = true;
      activeReadStream?.destroy();
      activeWriteStream?.destroy();
      zipfileRef?.close();
      reject(error);
    };

    yauzl.open(zipPath, { lazyEntries: true }, (err, zipfile) => {
      if (err) {
        fail(new DeployCoreError(DEPLOY_CORE_ERROR_CODES.ZIP_OPEN_FAILED, { zipPath, error: err.message }));
        return;
      }
      if (!zipfile) {
        fail(new DeployCoreError(DEPLOY_CORE_ERROR_CODES.ZIP_OPEN_FAILED, { zipPath }));
        return;
      }

      zipfileRef = zipfile;
      zipfile.readEntry();

      zipfile.on("entry", (entry: yauzl.Entry) => {
        if (settled) return;

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
            fail(new DeployCoreError(DEPLOY_CORE_ERROR_CODES.ZIP_ENTRY_DUPLICATE_PATH, {
              fileName: entry.fileName,
              normalizedPath,
            }));
            return;
          }

          // Check file count
          if (entries.length >= resolvedLimits.maxFiles) {
            fail(new DeployCoreError(DEPLOY_CORE_ERROR_CODES.ZIP_TOO_MANY_FILES, {
              maxFiles: resolvedLimits.maxFiles,
            }));
            return;
          }

          // Check uncompressed size
          const uncompressedSize = Number(entry.uncompressedSize);
          totalUncompressedSize += uncompressedSize;

          if (totalUncompressedSize > resolvedLimits.maxTotalUncompressedSize) {
            fail(new DeployCoreError(DEPLOY_CORE_ERROR_CODES.ZIP_TOTAL_SIZE_TOO_LARGE, {
              maxTotal: resolvedLimits.maxTotalUncompressedSize,
              actual: totalUncompressedSize,
            }));
            return;
          }

          // Check single file size
          if (uncompressedSize > resolvedLimits.maxSingleFileSize) {
            fail(new DeployCoreError(DEPLOY_CORE_ERROR_CODES.ZIP_SINGLE_FILE_TOO_LARGE, {
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
            fail(new DeployCoreError(DEPLOY_CORE_ERROR_CODES.ZIP_ENTRY_SYMLINK, {
              fileName: entry.fileName,
            }));
            return;
          }

          seenPaths.add(normalizedPath);

          // Open read stream for this entry
          zipfile.openReadStream(entry, (readErr, readStream) => {
            if (settled) {
              readStream?.destroy();
              return;
            }

            if (readErr || !readStream) {
              fail(new DeployCoreError(DEPLOY_CORE_ERROR_CODES.ZIP_EXTRACT_FAILED, {
                fileName: entry.fileName,
                error: readErr?.message,
              }));
              return;
            }

            const targetDir = resolve(workDir, normalizedPath);
            // Verify the resolved path is within workDir (append sep to prevent
            // prefix-only matches e.g. /tmp/foobar vs /tmp/foo).
            if (!targetDir.startsWith(resolve(workDir) + sep)) {
              fail(new DeployCoreError(DEPLOY_CORE_ERROR_CODES.ZIP_ENTRY_PATH_TRAVERSAL, {
                fileName: entry.fileName,
                normalizedPath,
              }));
              return;
            }

            mkdirSync(join(targetDir, ".."), { recursive: true });

            const writeStream = createWriteStream(targetDir);
            activeReadStream = readStream;
            activeWriteStream = writeStream;

            readStream.on("error", (readStreamErr) => {
              if (settled) return;
              fail(new DeployCoreError(DEPLOY_CORE_ERROR_CODES.ZIP_EXTRACT_FAILED, {
                fileName: entry.fileName,
                error: readStreamErr.message,
              }));
            });

            readStream.pipe(writeStream);

            writeStream.on("finish", () => {
              if (settled) return;
              // Set secure file permissions — don't inherit zip entry's Unix bits
              chmodSync(targetDir, 0o644);
              entries.push({
                path: normalizedPath,
                absPath: targetDir,
                size: uncompressedSize,
              });
              activeReadStream = null;
              activeWriteStream = null;
              zipfile.readEntry();
            });

            writeStream.on("error", (writeErr) => {
              if (settled) return;
              fail(new DeployCoreError(DEPLOY_CORE_ERROR_CODES.ZIP_EXTRACT_FAILED, {
                fileName: entry.fileName,
                error: writeErr.message,
              }));
            });
          });
        } catch (normalizeErr) {
          if (settled) return;
          if (normalizeErr instanceof DeployCoreError) {
            fail(normalizeErr);
          } else {
            fail(new DeployCoreError(DEPLOY_CORE_ERROR_CODES.ZIP_EXTRACT_FAILED, {
              fileName: entry.fileName,
              error: String(normalizeErr),
            }));
          }
        }
      });

      zipfile.on("end", () => {
        if (settled) return;
        settled = true;
        resolvePromise();
      });

      zipfile.on("error", (zipErr) => {
        if (settled) return;
        const msg = zipErr.message;
        // yauzl v3's validateFileName rejects entries before our handler sees them.
        // Translate yauzl error messages to the correct DeployCoreError codes.
        if (msg.startsWith("absolute path:")) {
          fail(new DeployCoreError(DEPLOY_CORE_ERROR_CODES.ZIP_ENTRY_ABSOLUTE_PATH, {
            error: msg,
          }));
        } else if (msg.startsWith("invalid relative path:")) {
          fail(new DeployCoreError(DEPLOY_CORE_ERROR_CODES.ZIP_ENTRY_PATH_TRAVERSAL, {
            error: msg,
          }));
        } else {
          fail(new DeployCoreError(DEPLOY_CORE_ERROR_CODES.ZIP_EXTRACT_FAILED, {
            error: msg,
          }));
        }
      });
    });
  });

  return entries;
}
