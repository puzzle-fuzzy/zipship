import type { Release } from '../../domain/projects';

export function buildProjectProductionPaths(projectSlug: string, activeRelease: Pick<Release, "releaseHash"> | undefined) {
  return {
    livePath: `/${projectSlug}/`,
    pinnedPath: activeRelease ? `/${projectSlug}/${activeRelease.releaseHash}/` : null,
  };
}
