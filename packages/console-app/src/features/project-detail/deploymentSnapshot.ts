import type { Release } from '../../domain/projects';
import { parseReleaseReport, summarizeReleaseGate } from "./releaseReport";

export function buildDeploymentReleaseSnapshot(release: Release | undefined) {
  if (!release) {
    return {
      qualityLevel: "unknown" as const,
      runtimeLevel: "unknown" as const,
      fileCount: null,
    };
  }

  const gate = summarizeReleaseGate(parseReleaseReport(release.detectResult));

  return {
    qualityLevel: gate.level,
    runtimeLevel: gate.runtimeLevel,
    fileCount: release.fileCount,
  };
}
