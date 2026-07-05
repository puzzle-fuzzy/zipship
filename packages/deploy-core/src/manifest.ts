// packages/deploy-core/src/manifest.ts

import type { FileEntry, Manifest, ManifestEntry } from "./types";
import { hashFile } from "./hash";

const HASH_CONCURRENCY = 16;

/**
 * Build a content-addressed manifest from extracted files.
 *
 * Steps:
 * 1. Hash each file's content (SHA-256, streamed)
 * 2. Sort entries by path (ASCII order, deterministic)
 * 3. Serialize to JSON, hash the JSON
 * 4. Derive releaseHash (first 12 characters)
 */
export async function buildManifest(files: FileEntry[]): Promise<Manifest> {
  const manifestEntries = await hashManifestEntries(files);

  // Stable sort by path
  manifestEntries.sort((a, b) => a.path.localeCompare(b.path));

  // JSON serialization — use stable key order
  const json = JSON.stringify({ version: 1, hashAlgorithm: "sha256", files: manifestEntries });
  const hash = await hashJsonString(json);
  const releaseHash = hash.slice(0, 12);

  return { version: 1, hashAlgorithm: "sha256", files: manifestEntries, hash, releaseHash };
}

async function hashJsonString(json: string): Promise<string> {
  const { createHash } = await import("crypto");
  return createHash("sha256").update(json, "utf-8").digest("hex");
}

async function hashManifestEntries(files: FileEntry[]): Promise<ManifestEntry[]> {
  const entries: ManifestEntry[] = [];
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < files.length) {
      const file = files[nextIndex];
      nextIndex += 1;
      entries.push({
        path: file.path,
        hash: await hashFile(file.absPath),
        size: file.size,
      });
    }
  }

  await Promise.all(Array.from({ length: Math.min(HASH_CONCURRENCY, files.length) }, () => worker()));

  return entries;
}
