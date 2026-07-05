import type { Release } from "../releases/model";
import type { Project } from "../projects/model";
import { contentTypeForPath, resolveStaticAssetPath } from "@zipship/storage";
import type { SitePreviewParams, SitePreviewResult } from "./model";

export interface SitePreviewRepository {
  findProjectBySlug(slug: string): Promise<Project | null>;
  findReadyReleaseByProjectIdAndHash(input: {
    projectId: string;
    releaseHash: string;
  }): Promise<Release | null>;
}

export interface SitePreviewServiceOptions {
  repository: SitePreviewRepository;
}

export class SitePreviewService {
  constructor(private readonly options: SitePreviewServiceOptions) {}

  async resolve(params: SitePreviewParams, requestPath: string): Promise<SitePreviewResult> {
    const project = await this.options.repository.findProjectBySlug(params.projectSlug);

    if (!project) return { kind: "not-found" };

    const release = await this.options.repository.findReadyReleaseByProjectIdAndHash({
      projectId: project.id,
      releaseHash: params.releaseHash,
    });

    if (!release || release.archivedAt !== null) return { kind: "not-found" };

    const resolved = await resolveStaticAssetPath({
      rootDir: release.storagePath,
      requestPath,
    });

    if (resolved.kind === "not-found") return resolved;

    return {
      kind: "file",
      absolutePath: resolved.absolutePath,
      contentType: contentTypeForPath(resolved.absolutePath),
    };
  }
}
