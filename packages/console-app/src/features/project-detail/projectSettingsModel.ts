import type { Release } from "../../stores/projectsStore";

export function buildProjectProductionPaths(projectSlug: string, activeRelease: Pick<Release, "releaseHash"> | undefined) {
  return {
    livePath: `/${projectSlug}/`,
    pinnedPath: activeRelease ? `/${projectSlug}/${activeRelease.releaseHash}/` : null,
  };
}
