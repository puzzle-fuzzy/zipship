/**
 * Cross-platform path utilities for tests.
 *
 * On Windows, `readlinkSync` and some filesystem APIs return paths with
 * backslash (`\`) separators, while our expected strings use forward slashes.
 * These helpers bridge that gap.
 */

import { readlinkSync } from "fs";

/** Replace all backslash path separators with forward slashes. */
export function normalizePath(p: string): string {
  return p.replace(/\\/g, "/");
}

/** Read a symlink target and normalize its separators to forward slashes. */
export function readLinkTarget(linkPath: string): string {
  return normalizePath(readlinkSync(linkPath));
}
