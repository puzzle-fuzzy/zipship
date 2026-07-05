// packages/deploy-core/src/hash.ts

import { createHash } from "crypto";
import { createReadStream } from "fs";

/**
 * Compute SHA-256 hex hash of a file using streaming reads.
 */
export async function hashFile(absPath: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(absPath);

    stream.on("data", (chunk: Buffer) => {
      hash.update(chunk);
    });

    stream.on("end", () => {
      resolve(hash.digest("hex"));
    });

    stream.on("error", (err) => {
      reject(err);
    });
  });
}

/**
 * Derive a truncated release hash from the full manifest hash.
 */
export function deriveReleaseHash(fullHash: string, length = 12): string {
  return fullHash.slice(0, Math.min(length, fullHash.length));
}
