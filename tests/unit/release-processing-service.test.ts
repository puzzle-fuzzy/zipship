import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { ReleaseProcessingService } from "../../apps/api/src/modules/release-processing/service";
import { createStoragePaths } from "@zipship/storage";
import type { UploadTask } from "../../apps/api/src/modules/uploads/model";
import type { Project } from "../../apps/api/src/modules/projects/model";
import type { RuntimeCheckResult } from "../../apps/api/src/modules/runtime-check/service";

const NOW = new Date("2026-07-09T00:00:00.000Z");
const FIXTURE = join(import.meta.dir, "../../packages/deploy-core/tests/fixtures/valid-vite-relative-base.zip");

let storageRoot = "";

beforeEach(() => {
  storageRoot = mkdtempSync(join(tmpdir(), "zipship-release-processing-"));
});

afterEach(() => {
  rmSync(storageRoot, { recursive: true, force: true });
});

function uploadTask(overrides: Partial<UploadTask> = {}): UploadTask {
  return {
    id: "upload-1",
    projectId: "project-1",
    releaseId: "release-1",
    status: "processing",
    rawUploadPath: FIXTURE,
    originalFilename: "dist.zip",
    size: 1024,
    errorMessage: null,
    createdBy: "user-1",
    createdAt: NOW.toISOString(),
    startedAt: NOW.toISOString(),
    finishedAt: null,
    ...overrides,
  };
}

function project(overrides: Partial<Project> = {}): Project {
  return {
    id: "project-1",
    organizationId: "org-1",
    name: "Marketing",
    slug: "marketing",
    description: null,
    currentReleaseId: null,
    spaFallback: true,
    cachePolicy: "standard",
    customDomains: [],
    status: "active",
    visibility: "private",
    createdBy: "user-1",
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    ...overrides,
  };
}

function runtimeResult(url: string): RuntimeCheckResult {
  return {
    level: "warning",
    checkedAt: NOW.toISOString(),
    url,
    snapshot: {
      finalUrl: url,
      status: 200,
      bodyText: "Hello ZipShip",
      consoleMessages: [{ type: "error", text: "ReferenceError: app is not defined" }],
      failedRequests: [],
    },
    items: [
      {
        level: "warning",
        code: "RUNTIME_CONSOLE_ERRORS",
        details: { count: 1, samples: ["ReferenceError: app is not defined"] },
      },
    ],
  };
}

function build(options: {
  runtimeCheck?: { check(url: string): Promise<RuntimeCheckResult> };
} = {}) {
  const task = uploadTask();
  const attachedRuntimeChecks: Array<{ releaseId: string; runtimeCheck: Record<string, unknown> }> = [];
  const completedDetectResults: Record<string, unknown>[] = [];

  const service = new ReleaseProcessingService({
    projectsRepository: {
      async findProjectById() {
        return project();
      },
    },
    uploadsRepository: {
      async findUploadTaskById() {
        return task;
      },
    },
    releaseProcessingRepository: {
      async completeProcessedRelease(input) {
        completedDetectResults.push(input.detectResult);
        return { ...task, status: "completed", finishedAt: input.finishedAt.toISOString() };
      },
      async failProcessedRelease(input) {
        return {
          ...task,
          status: "failed",
          errorMessage: input.errorCode,
          finishedAt: input.finishedAt.toISOString(),
        };
      },
      async attachRuntimeCheck(input) {
        attachedRuntimeChecks.push(input);
      },
    },
    storagePaths: createStoragePaths(storageRoot),
    now: () => NOW,
    runtimeCheck: options.runtimeCheck,
    runtimePreviewBaseUrl: "http://localhost:3001/",
  });

  return { service, attachedRuntimeChecks, completedDetectResults };
}

describe("ReleaseProcessingService runtime check", () => {
  test("attaches runtime check result after a ready release is persisted", async () => {
    const checkedUrls: string[] = [];
    const { service, attachedRuntimeChecks, completedDetectResults } = build({
      runtimeCheck: {
        async check(url) {
          checkedUrls.push(url);
          return runtimeResult(url);
        },
      },
    });

    const result = await service.processUploadTask("upload-1");

    expect(result).toEqual({ status: "ready" });
    expect(checkedUrls).toHaveLength(1);
    expect(checkedUrls[0]).toMatch(/^http:\/\/localhost:3001\/_sites\/marketing\/[a-f0-9]{12}\/$/);
    expect(completedDetectResults[0]).toMatchObject({ level: "pass" });
    expect(attachedRuntimeChecks).toEqual([
      {
        releaseId: "release-1",
        runtimeCheck: runtimeResult(checkedUrls[0]) as unknown as Record<string, unknown>,
      },
    ]);
  });

  test("records a failed runtime check without failing release processing", async () => {
    const { service, attachedRuntimeChecks } = build({
      runtimeCheck: {
        async check() {
          throw new Error("chromium unavailable");
        },
      },
    });

    const result = await service.processUploadTask("upload-1");

    expect(result).toEqual({ status: "ready" });
    expect(attachedRuntimeChecks).toHaveLength(1);
    expect(attachedRuntimeChecks[0].runtimeCheck).toMatchObject({
      level: "failed",
      checkedAt: NOW.toISOString(),
      url: expect.stringMatching(/^http:\/\/localhost:3001\/_sites\/marketing\/[a-f0-9]{12}\/$/),
      items: [
        {
          level: "failed",
          code: "RUNTIME_CHECK_FAILED",
          details: { message: "chromium unavailable" },
        },
      ],
    });
  });
});
