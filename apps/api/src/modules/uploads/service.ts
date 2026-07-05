import {
  InvalidUploadInputError,
  UploadForbiddenError,
  UploadProjectNotFoundError,
  UploadServiceError,
  UploadUnauthorizedError,
} from "./model";
import type { CreateUploadTaskBody, CreateUploadTaskSuccess, UploadHeaders, UploadParams, UploadTask } from "./model";
import type { MemberRole } from "../permissions/model";
import { PermissionService } from "../permissions/service";
import type { Project } from "../projects/model";

export interface UploadsRepository {
  findSessionByRefreshTokenHash(
    refreshTokenHash: string,
    now: Date,
  ): Promise<{
    user: {
      id: string;
      name: string;
      email: string;
    };
    session: {
      id: string;
      clientType: "web" | "desktop";
      expiresAt: string;
    };
  } | null>;
  findProjectById(projectId: string): Promise<Project | null>;
  findMembership(input: {
    organizationId: string;
    userId: string;
  }): Promise<{
    role: MemberRole;
  } | null>;
  createUploadTask(input: {
    projectId: string;
    originalFilename: string;
    size: number;
    createdBy: string;
    now: Date;
  }): Promise<UploadTask>;
}

export interface UploadsServiceOptions {
  repository: UploadsRepository;
  hashRefreshToken: (token: string) => Promise<string>;
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

    const project = await this.options.repository.findProjectById(params.projectId);

    if (!project) return new UploadProjectNotFoundError();

    const membership = await this.options.repository.findMembership({
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
      uploadTask: await this.options.repository.createUploadTask({
        projectId: project.id,
        originalFilename,
        size: body.size,
        createdBy: currentUser.user.id,
        now: this.options.now(),
      }),
    };
  }

  private async requireCurrentUser(headers: UploadHeaders) {
    const refreshToken = parseBearerToken(headers.authorization);

    if (!refreshToken) return new UploadUnauthorizedError();

    const currentSession = await this.options.repository.findSessionByRefreshTokenHash(
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
