import { Elysia } from "elysia";
import { sitePreviewModels } from "./model";
import { SitePreviewService } from "./service";
import type { SitePreviewRepository } from "./service";

export interface SitePreviewModuleOptions {
  repository: SitePreviewRepository;
}

export function sitePreviewModule(options: SitePreviewModuleOptions) {
  const sitePreview = new SitePreviewService({
    repository: options.repository,
  });

  async function serve(params: { projectSlug: string; releaseHash: string }, requestPath: string) {
    const result = await sitePreview.resolve(params, requestPath);

    if (result.kind === "not-found") {
      return new Response("Not Found", {
        status: 404,
      });
    }

    return new Response(Bun.file(result.absolutePath), {
      headers: {
        "content-type": result.contentType,
      },
    });
  }

  return new Elysia({ name: "site-preview", prefix: "/_sites/:projectSlug/:releaseHash" })
    .model(sitePreviewModels)
    .get("/", ({ params }) => serve(params, ""), {
      params: "SitePreview.Params",
    })
    .get("/*", ({ params }) => serve({ projectSlug: params.projectSlug, releaseHash: params.releaseHash }, (params as { "*"?: string })["*"] ?? ""));
}
