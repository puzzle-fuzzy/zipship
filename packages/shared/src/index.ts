export const ZIPSHIP_RESERVED_SLUGS = [
  "_api",
  "_console",
  "_health",
  "_assets",
  "favicon.ico",
  "robots.txt",
] as const;

/**
 * Single source of truth for the role / status enums shared between the db
 * (Drizzle pgEnums) and the api / frontend (union types). The db pgEnums
 * spread these arrays (see packages/db/src/schema.ts) so the two definitions
 * can't drift apart.
 */
export const MEMBER_ROLES = [
  "owner",
  "admin",
  "developer",
  "deployer",
  "viewer",
] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

export const RELEASE_STATUSES = [
  "uploading",
  "processing",
  "ready",
  "active",
  "failed",
  "archived",
  "deleted",
] as const;
export type ReleaseStatus = (typeof RELEASE_STATUSES)[number];

export const DEPLOYMENT_ACTIONS = [
  "publish",
  "rollback",
  "promote",
  "archive",
] as const;
export type DeploymentAction = (typeof DEPLOYMENT_ACTIONS)[number];
