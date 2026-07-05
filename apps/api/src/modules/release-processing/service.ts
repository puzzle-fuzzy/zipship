import { mkdir, rm } from "fs/promises";
import { existsSync } from "fs";
import { processRelease, DeployCoreError } from "@zipship/deploy-core";
import type { StoragePaths } from "@zipship/storage";
import { copyDirectoryContents, createReleaseStoragePath, createUploadWorkDir } from "@zipship/storage";
import { ReleaseProcessingError } from "./model";
import type { ReleaseProcessingResult } from "./model";
import type { UploadTask } from "../uploads/model";

export interface ReleaseProcessingRepository {
  findUploadTaskById(uploadTaskId: string): Promise<UploadTask | null>;
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
    detectResult: Record<string, unknown>;
    finishedAt: Date;
  }): Promise<UploadTask>;
}

export interface ReleaseProcessingServiceOptions {
  repository: ReleaseProcessingRepository;
  storagePaths: StoragePaths;
  now: () => Date;
}

export class ReleaseProcessingService {
  constructor(private readonly options: ReleaseProcessingServiceOptions) {}

  async processUploadTask(uploadTaskId: string): Promise<ReleaseProcessingResult> {
    const uploadTask = await this.options.repository.findUploadTaskById(uploadTaskId);

    if (!uploadTask) return new ReleaseProcessingError("UPLOAD_TASK_NOT_FOUND");
    if (!uploadTask.releaseId) return new ReleaseProcessingError("RELEASE_NOT_FOUND");
    if (!existsSync(uploadTask.rawUploadPath)) return new ReleaseProcessingError("RAW_UPLOAD_REQUIRED");

    const workDir = createUploadWorkDir(this.options.storagePaths, uploadTask.id);

    await rm(workDir, { recursive: true, force: true });
    await mkdir(workDir, { recursive: true });

    try {
      const result = await processRelease({
        zipPath: uploadTask.rawUploadPath,
        workDir,
      });

      const releaseStoragePath = createReleaseStoragePath(this.options.storagePaths, {
        projectSlug: uploadTask.projectId,
        releaseHash: result.manifest.releaseHash,
      });
      const totalSize = result.manifest.files.reduce((sum, file) => sum + file.size, 0);

      if (result.detect.level === "failed") {
        await this.options.repository.failProcessedRelease({
          uploadTaskId: uploadTask.id,
          releaseId: uploadTask.releaseId,
          errorCode: "DETECT_FAILED",
          detectResult: result.detect as unknown as Record<string, unknown>,
          finishedAt: this.options.now(),
        });

        return new ReleaseProcessingError("DETECT_FAILED", {
          releaseId: uploadTask.releaseId,
        });
      }

      await copyDirectoryContents(result.rootDir, releaseStoragePath);

      await this.options.repository.completeProcessedRelease({
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

      return {
        status: "ready",
      };
    } catch (error) {
      const errorCode = error instanceof DeployCoreError ? `DEPLOY_CORE:${error.code}` : "DEPLOY_CORE_FAILED";

      await this.options.repository.failProcessedRelease({
        uploadTaskId: uploadTask.id,
        releaseId: uploadTask.releaseId,
        errorCode,
        detectResult: {
          level: "failed",
          items: [
            {
              level: "failed",
              code: errorCode,
            },
          ],
        },
        finishedAt: this.options.now(),
      });

      return new ReleaseProcessingError("DEPLOY_CORE_FAILED", {
        errorCode,
      });
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  }
}
