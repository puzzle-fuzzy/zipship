export const ZIPSHIP_RESERVED_SLUGS = [
  "_api",
  "_console",
  "_health",
  "_assets",
  "favicon.ico",
  "robots.txt",
] as const;

export type MemberRole = "owner" | "admin" | "developer" | "deployer" | "viewer";
export type ReleaseStatus = "uploading" | "processing" | "ready" | "active" | "failed" | "archived" | "deleted";
export type DeploymentAction = "publish" | "rollback" | "promote" | "archive";
