import type { Release } from "../../stores/projectsStore";

export function findUploadedReleaseHighlight(
  releases: Pick<Release, "id">[],
  previousLatestReleaseId: string | null,
) {
  const latestRelease = releases[0] ?? null;
  if (!latestRelease) return null;
  if (latestRelease.id === previousLatestReleaseId) return null;
  return latestRelease.id;
}
