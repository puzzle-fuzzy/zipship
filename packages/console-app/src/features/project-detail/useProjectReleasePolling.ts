import { useCallback, useEffect, useRef, useState } from "react";
import type { Release } from "../../stores/projectsStore";
import {
  RELEASE_POLLING_INTERVAL_MS,
  shouldPollReleases,
} from "./releasePolling";

interface UseProjectReleasePollingInput {
  projectId: string | undefined;
  releases: Release[];
  fetchReleases: (projectId: string) => Promise<void>;
}

export function useProjectReleasePolling({
  projectId,
  releases,
  fetchReleases,
}: UseProjectReleasePollingInput) {
  const [enabled, setEnabled] = useState(false);
  const attempts = useRef(0);

  const startReleasePolling = useCallback(() => {
    attempts.current = 0;
    setEnabled(true);
  }, []);

  useEffect(() => {
    if (!projectId || !enabled) return;

    if (
      !shouldPollReleases({
        enabled,
        releases,
        attempts: attempts.current,
      })
    ) {
      setEnabled(false);
      return;
    }

    const timer = window.setTimeout(() => {
      attempts.current += 1;
      void fetchReleases(projectId);
    }, RELEASE_POLLING_INTERVAL_MS);

    return () => window.clearTimeout(timer);
  }, [projectId, enabled, releases, fetchReleases]);

  return {
    releasePollingEnabled: enabled,
    startReleasePolling,
  };
}
