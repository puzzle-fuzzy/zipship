import { mkdir, rm } from "fs/promises";
import { existsSync } from "fs";
import { processRelease, DeployCoreError } from "@zipship/deploy-core";
import type { StoragePaths } from "@zipship/storage";
import { copyDirectoryContents, createReleaseStoragePath, createUploadWorkDir } from "@zipship/storage";
import { ReleaseProcessingError } from "./model";
import type { ReleaseProcessingResult } from "./model";
import type { UploadTask } from "../uploads/model";
import type { UploadsRepository } from "../uploads/service";
import type { ProjectsRepository } from "../projects/service";
import type { RuntimeCheckResult } from "../runtime-check/service";

export interface ReleaseProcessingRepository {
  completeProcessedRelease(input: {
    uploadTaskId: string;
    releaseId: string;
    releaseHash: string;
    fullHash: string;
    storagePath: string;
    fileCount: number;
    totalSize: number;
    manifest: Record<string, unknown>;
    detectResult: Record<string, unknown>;
    finishedAt: Date;
  }): Promise<UploadTask>;
  failProcessedRelease(input: {
    uploadTaskId: string;
    releaseId: string;
    errorCode: string;
    totalSize: number;
    detectResult: Record<string, unknown>;
    finishedAt: Date;
  }): Promise<UploadTask>;
  attachRuntimeCheck(input: {
    releaseId: string;
    runtimeCheck: Record<string, unknown>;
  }): Promise<void>;
}

export interface RuntimeCheckRunner {
  check(url: string): Promise<RuntimeCheckResult>;
}

export interface ReleaseProcessingServiceOptions {
  projectsRepository: Pick<ProjectsRepository, "findProjectById">;
  uploadsRepository: Pick<UploadsRepository, "findUploadTaskById">;
  releaseProcessingRepository: ReleaseProcessingRepository;
  storagePaths: StoragePaths;
  now: () => Date;
  runtimeCheck?: RuntimeCheckRunner;
  runtimePreviewBaseUrl?: string;
}

export class ReleaseProcessingService {
  constructor(private readonly options: ReleaseProcessingServiceOptions) {}

  async processUploadTask(uploadTaskId: string): Promise<ReleaseProcessingResult> {
    const uploadTask = await this.options.uploadsRepository.findUploadTaskById(uploadTaskId);

    if (!uploadTask) return new ReleaseProcessingError("UPLOAD_TASK_NOT_FOUND");
    if (!uploadTask.releaseId) return new ReleaseProcessingError("RELEASE_NOT_FOUND");
    if (!existsSync(uploadTask.rawUploadPath)) return new ReleaseProcessingError("RAW_UPLOAD_REQUIRED");

    const project = await this.options.projectsRepository.findProjectById(uploadTask.projectId);
    if (!project) return new ReleaseProcessingError("PROJECT_NOT_FOUND");

    const workDir = createUploadWorkDir(this.options.storagePaths, uploadTask.id);

    await rm(workDir, { recursive: true, force: true });
    await mkdir(workDir, { recursive: true });

    try {
      const result = await processRelease({
        zipPath: uploadTask.rawUploadPath,
        workDir,
      });

      const releaseStoragePath = createReleaseStoragePath(this.options.storagePaths, {
        projectSlug: project.slug,
        releaseHash: result.manifest.releaseHash,
      });
      const totalSize = result.manifest.files.reduce((sum, file) => sum + file.size, 0);

      if (result.detect.level === "failed") {
        await this.options.releaseProcessingRepository.failProcessedRelease({
          uploadTaskId: uploadTask.id,
          releaseId: uploadTask.releaseId,
          errorCode: "DETECT_FAILED",
          totalSize: uploadTask.size,
          detectResult: result.detect as unknown as Record<string, unknown>,
          finishedAt: this.options.now(),
        });

        return new ReleaseProcessingError("DETECT_FAILED", {
          releaseId: uploadTask.releaseId,
        });
      }

      await copyDirectoryContents(result.rootDir, releaseStoragePath);

      await this.options.releaseProcessingRepository.completeProcessedRelease({
        uploadTaskId: uploadTask.id,
        releaseId: uploadTask.releaseId,
        releaseHash: result.manifest.releaseHash,
        fullHash: result.manifest.hash,
        storagePath: releaseStoragePath,
        fileCount: result.manifest.files.length,
        totalSize,
        manifest: result.manifest as unknown as Record<string, unknown>,
        detectResult: result.detect as unknown as Record<string, unknown>,
        finishedAt: this.options.now(),
      });

      await this.attachRuntimeCheckIfConfigured({
        releaseId: uploadTask.releaseId,
        projectSlug: project.slug,
        releaseHash: result.manifest.releaseHash,
      });

      return {
        status: "ready",
      };
    } catch (error) {
      const errorCode = error instanceof DeployCoreError ? `DEPLOY_CORE:${error.code}` : "DEPLOY_CORE_FAILED";

      const errorMessage = error instanceof Error ? error.message : String(error);

      await this.options.releaseProcessingRepository.failProcessedRelease({
        uploadTaskId: uploadTask.id,
        releaseId: uploadTask.releaseId,
        errorCode,
        totalSize: uploadTask.size,
        detectResult: {
          level: "failed",
          items: [
            {
              level: "failed",
              code: errorCode,
              details: { message: errorMessage },
            },
          ],
        },
        finishedAt: this.options.now(),
      });

      return new ReleaseProcessingError("DEPLOY_CORE_FAILED", {
        errorCode,
        errorMessage,
      });
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  }

  private async attachRuntimeCheckIfConfigured(input: {
    releaseId: string;
    projectSlug: string;
    releaseHash: string;
  }): Promise<void> {
    if (!this.options.runtimeCheck || !this.options.runtimePreviewBaseUrl) return;

    const previewUrl = buildPreviewUrl(this.options.runtimePreviewBaseUrl, input.projectSlug, input.releaseHash);

    try {
      const runtimeCheck = await this.options.runtimeCheck.check(previewUrl);
      await this.options.releaseProcessingRepository.attachRuntimeCheck({
        releaseId: input.releaseId,
        runtimeCheck: runtimeCheck as unknown as Record<string, unknown>,
      });
    } catch (error) {
      await this.options.releaseProcessingRepository.attachRuntimeCheck({
        releaseId: input.releaseId,
        runtimeCheck: buildRuntimeCheckFailure(previewUrl, this.options.now(), error),
      });
    }
  }
}

function buildPreviewUrl(baseUrl: string, projectSlug: string, releaseHash: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/_sites/${projectSlug}/${releaseHash}/`;
}

function buildRuntimeCheckFailure(
  url: string,
  checkedAt: Date,
  error: unknown,
): Record<string, unknown> {
  return {
    level: "failed",
    checkedAt: checkedAt.toISOString(),
    url,
    snapshot: {
      finalUrl: url,
      status: null,
      bodyText: "",
      consoleMessages: [],
      failedRequests: [],
    },
    items: [
      {
        level: "failed",
        code: "RUNTIME_CHECK_FAILED",
        details: {
          message: error instanceof Error ? error.message : String(error),
        },
      },
    ],
  };
}
