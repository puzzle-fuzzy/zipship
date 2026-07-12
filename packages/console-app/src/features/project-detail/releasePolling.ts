import type { Release } from "../../stores/projectsStore";

export const RELEASE_POLLING_INTERVAL_MS = 2500;
export const RELEASE_POLLING_MAX_ATTEMPTS = 24;

export function hasPendingRelease(releases: Pick<Release, "status">[]) {
  return releases.some((release) => release.status === "uploading" || release.status === "processing");
}

export function shouldPollReleases(input: {
  enabled: boolean;
  releases: Pick<Release, "status">[];
  attempts: number;
  maxAttempts?: number;
}) {
  return (
    input.enabled &&
    input.attempts < (input.maxAttempts ?? RELEASE_POLLING_MAX_ATTEMPTS) &&
    (input.attempts === 0 || hasPendingRelease(input.releases))
  );
}
