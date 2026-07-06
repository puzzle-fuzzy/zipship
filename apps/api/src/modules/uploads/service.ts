import { existsSync } from "fs";
import {
  InvalidUploadInputError,
  RawUploadRequiredError,
  UploadForbiddenError,
  UploadProjectNotFoundError,
  UploadServiceError,
  UploadTaskNotFoundError,
  UploadTaskNotPendingError,
  UploadTaskNotUploadingError,
  UploadUnauthorizedError,
} from "./model";
import type {
  CreateUploadTaskBody,
  CreateUploadTaskSuccess,
  UploadDetailParams,
  UploadHeaders,
  UploadParams,
  UploadRawBody,
  UploadTask,
  UploadTaskDetail,
} from "./model";
import { PermissionService } from "../permissions/service";
import type { AuthRepository } from "../auth/service";
import type { ProjectsRepository } from "../projects/service";
import type { OrganizationsRepository } from "../organizations/service";
import type { StoragePaths } from "@zipship/storage";
import { createUploadRawPath, writeFileToPath } from "@zipship/storage";

export interface UploadsRepository {
  createUploadTask(input: {
    projectId: string;
    originalFilename: string;
    size: number;
    createdBy: string;
    now: Date;
  }): Promise<UploadTask>;
  findUploadTaskById(uploadTaskId: string): Promise<UploadTask | null>;
  markUploadTaskProcessing(input: {
    uploadTaskId: string;
    projectId: string;
    createdBy: string;
    now: Date;
  }): Promise<UploadTask>;
  markUploadTaskUploaded(input: {
    uploadTaskId: string;
    rawUploadPath: string;
    size: number;
  }): Promise<UploadTask>;
}

export interface UploadsServiceOptions {
  sessionRepository: Pick<AuthRepository, "findSessionByRefreshTokenHash">;
  projectsRepository: Pick<ProjectsRepository, "findProjectById">;
  membersRepository: Pick<OrganizationsRepository, "findMembership">;
  uploadsRepository: UploadsRepository;
  hashRefreshToken: (token: string) => Promise<string>;
  storagePaths: StoragePaths;
  now: () => Date;
  permissions?: PermissionService;
}

export class UploadsService {
  private readonly permissions: PermissionService;

  constructor(private readonly options: UploadsServiceOptions) {
    this.permissions = options.permissions ?? new PermissionService();
  }

  async create(
    headers: UploadHeaders,
    params: UploadParams,
    body: CreateUploadTaskBody,
  ): Promise<CreateUploadTaskSuccess | UploadServiceError> {
    const currentUser = await this.requireCurrentUser(headers);

    if (currentUser instanceof UploadServiceError) return currentUser;

    const project = await this.options.projectsRepository.findProjectById(params.projectId);

    if (!project) return new UploadProjectNotFoundError();

    const membership = await this.options.membersRepository.findMembership({
      organizationId: project.organizationId,
      userId: currentUser.user.id,
    });

    if (!membership) return new UploadForbiddenError();
    if (!this.permissions.can(membership.role, "upload_release")) return new UploadForbiddenError();

    const originalFilename = normalizeFilename(body.originalFilename);

    if (!originalFilename || !isZipFilename(originalFilename) || !Number.isInteger(body.size) || body.size < 1) {
      return new InvalidUploadInputError();
    }

    return {
      uploadTask: await this.options.uploadsRepository.createUploadTask({
        projectId: project.id,
        originalFilename,
        size: body.size,
        createdBy: currentUser.user.id,
        now: this.options.now(),
      }),
    };
  }

  async get(headers: UploadHeaders, params: UploadDetailParams): Promise<UploadTaskDetail | UploadServiceError> {
    const currentUser = await this.requireCurrentUser(headers);

    if (currentUser instanceof UploadServiceError) return currentUser;

    const uploadTask = await this.options.uploadsRepository.findUploadTaskById(params.uploadTaskId);

    if (!uploadTask) return new UploadTaskNotFoundError();

    const project = await this.options.projectsRepository.findProjectById(uploadTask.projectId);

    if (!project) return new UploadProjectNotFoundError();

    const membership = await this.options.membersRepository.findMembership({
      organizationId: project.organizationId,
      userId: currentUser.user.id,
    });

    if (!membership) return new UploadForbiddenError();
    if (!this.permissions.can(membership.role, "view_project")) return new UploadForbiddenError();

    return {
      uploadTask,
    };
  }

  async uploadRaw(
    headers: UploadHeaders,
    params: UploadDetailParams,
    body: UploadRawBody,
  ): Promise<UploadTaskDetail | UploadServiceError> {
    const currentUser = await this.requireCurrentUser(headers);

    if (currentUser instanceof UploadServiceError) return currentUser;

    const uploadTask = await this.options.uploadsRepository.findUploadTaskById(params.uploadTaskId);

    if (!uploadTask) return new UploadTaskNotFoundError();
    if (uploadTask.status !== "pending" && uploadTask.status !== "uploading") return new UploadTaskNotPendingError();

    const project = await this.options.projectsRepository.findProjectById(uploadTask.projectId);

    if (!project) return new UploadProjectNotFoundError();

    const membership = await this.options.membersRepository.findMembership({
      organizationId: project.organizationId,
      userId: currentUser.user.id,
    });

    if (!membership) return new UploadForbiddenError();
    if (!this.permissions.can(membership.role, "upload_release")) return new UploadForbiddenError();

    const rawUploadPath = createUploadRawPath(this.options.storagePaths, {
      projectId: project.id,
      uploadTaskId: uploadTask.id,
      filename: uploadTask.originalFilename,
    });

    const written = await writeFileToPath(body.file, rawUploadPath);

    return {
      uploadTask: await this.options.uploadsRepository.markUploadTaskUploaded({
        uploadTaskId: uploadTask.id,
        rawUploadPath,
        size: written.size,
      }),
    };
  }

  async complete(headers: UploadHeaders, params: UploadDetailParams): Promise<UploadTaskDetail | UploadServiceError> {
    const currentUser = await this.requireCurrentUser(headers);

    if (currentUser instanceof UploadServiceError) return currentUser;

    const uploadTask = await this.options.uploadsRepository.findUploadTaskById(params.uploadTaskId);

    if (!uploadTask) return new UploadTaskNotFoundError();
    if (uploadTask.status === "pending") return new RawUploadRequiredError();
    if (uploadTask.status !== "uploading") return new UploadTaskNotUploadingError();
    if (!existsSync(uploadTask.rawUploadPath)) return new RawUploadRequiredError();

    const project = await this.options.projectsRepository.findProjectById(uploadTask.projectId);

    if (!project) return new UploadProjectNotFoundError();

    const membership = await this.options.membersRepository.findMembership({
      organizationId: project.organizationId,
      userId: currentUser.user.id,
    });

    if (!membership) return new UploadForbiddenError();
    if (!this.permissions.can(membership.role, "upload_release")) return new UploadForbiddenError();

    return {
      uploadTask: await this.options.uploadsRepository.markUploadTaskProcessing({
        uploadTaskId: uploadTask.id,
        projectId: project.id,
        createdBy: currentUser.user.id,
        now: this.options.now(),
      }),
    };
  }

  private async requireCurrentUser(headers: UploadHeaders) {
    const refreshToken = parseBearerToken(headers.authorization);

    if (!refreshToken) return new UploadUnauthorizedError();

    const currentSession = await this.options.sessionRepository.findSessionByRefreshTokenHash(
      await this.options.hashRefreshToken(refreshToken),
      this.options.now(),
    );

    if (!currentSession) return new UploadUnauthorizedError();

    return currentSession;
  }
}

function normalizeFilename(filename: string): string | null {
  const normalized = filename.trim();

  if (!normalized || normalized === "." || normalized === "..") return null;
  if (normalized.includes("/") || normalized.includes("\\")) return null;

  return normalized;
}

function isZipFilename(filename: string): boolean {
  return filename.toLowerCase().endsWith(".zip");
}

function parseBearerToken(authorization: string | undefined): string | null {
  if (!authorization) return null;

  const [scheme, token] = authorization.split(" ");

  if (scheme !== "Bearer" || !token) return null;

  return token;
}
