import { t } from "elysia";

export const sitePreviewParamsModel = t.Object({
  projectSlug: t.String(),
  releaseHash: t.String(),
}, { additionalProperties: true });

export const sitePreviewModels = {
  "SitePreview.Params": sitePreviewParamsModel,
};

export type SitePreviewParams = typeof sitePreviewParamsModel.static;

export interface SitePreviewFile {
  kind: "file";
  absolutePath: string;
  contentType: string;
}

export interface SitePreviewNotFound {
  kind: "not-found";
}

export type SitePreviewResult = SitePreviewFile | SitePreviewNotFound;
