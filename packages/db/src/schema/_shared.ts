import {
  pgEnum,
  timestamp,
} from "drizzle-orm/pg-core";
// Role / status values are owned by @zipship/shared (single source of truth)
// and spread into the pgEnums below so the db and the app can't drift.
import {
  DEPLOYMENT_ACTIONS,
  MEMBER_ROLES,
  RELEASE_STATUSES,
} from "@zipship/shared";

export const userStatusEnum = pgEnum("user_status", ["active", "disabled"]);
export const organizationPlanEnum = pgEnum("organization_plan", ["free", "team", "enterprise"]);
export const memberRoleEnum = pgEnum("member_role", [...MEMBER_ROLES]);
export const memberStatusEnum = pgEnum("member_status", ["active", "invited", "disabled"]);
export const invitationStatusEnum = pgEnum("invitation_status", ["pending", "accepted", "expired", "revoked"]);
export const projectStatusEnum = pgEnum("project_status", ["active", "archived"]);
export const projectVisibilityEnum = pgEnum("project_visibility", ["private", "organization"]);
export const releaseStatusEnum = pgEnum("release_status", [...RELEASE_STATUSES]);
export const deploymentActionEnum = pgEnum("deployment_action", [...DEPLOYMENT_ACTIONS]);
export const deploymentStatusEnum = pgEnum("deployment_status", ["pending", "success", "failed"]);
export const uploadTaskStatusEnum = pgEnum("upload_task_status", ["pending", "uploading", "processing", "completed", "failed"]);
export const clientTypeEnum = pgEnum("client_type", ["web", "desktop"]);
export const desktopLoginStatusEnum = pgEnum("desktop_login_status", ["pending", "authorized", "exchanged", "expired", "revoked"]);
export const desktopTicketStatusEnum = pgEnum("desktop_ticket_status", ["pending", "used", "expired", "revoked"]);

/** Shared created_at / updated_at columns. */
export const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};
