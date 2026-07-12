import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import {
  deploymentActionEnum,
  deploymentStatusEnum,
  invitationStatusEnum,
  memberRoleEnum,
  projectStatusEnum,
  projectVisibilityEnum,
  releaseStatusEnum,
  uploadTaskStatusEnum,
} from "./_shared";
import { organizations, users } from "./accounts";

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 160 }).notNull(),
    slug: varchar("slug", { length: 80 }).notNull(),
    description: text("description"),
    currentReleaseId: uuid("current_release_id"),
    spaFallback: boolean("spa_fallback").notNull().default(true),
    cachePolicy: varchar("cache_policy", { length: 32 }).notNull().default("standard"),
    customDomains: text("custom_domains").array().notNull().default([]),
    status: projectStatusEnum("status").notNull().default("active"),
    visibility: projectVisibilityEnum("visibility").notNull().default("private"),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("projects_slug_unique").on(table.slug),
    index("projects_organization_id_idx").on(table.organizationId),
    index("projects_current_release_id_idx").on(table.currentReleaseId),
  ],
);

export const invitations = pgTable(
  "invitations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
    email: varchar("email", { length: 255 }).notNull(),
    role: memberRoleEnum("role").notNull().default("developer"),
    tokenHash: text("token_hash").notNull(),
    invitedBy: uuid("invited_by").notNull().references(() => users.id),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    status: invitationStatusEnum("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("invitations_token_hash_unique").on(table.tokenHash),
    index("invitations_organization_email_idx").on(table.organizationId, table.email),
  ],
);

export const releases = pgTable(
  "releases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    versionNumber: integer("version_number").notNull(),
    releaseHash: varchar("release_hash", { length: 32 }).notNull(),
    fullHash: text("full_hash").notNull(),
    status: releaseStatusEnum("status").notNull().default("uploading"),
    storagePath: text("storage_path").notNull(),
    rawUploadPath: text("raw_upload_path"),
    fileCount: integer("file_count").notNull().default(0),
    totalSize: bigint("total_size", { mode: "number" }).notNull().default(0),
    manifest: jsonb("manifest").notNull().default({}),
    detectResult: jsonb("detect_result").notNull().default({}),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    activatedAt: timestamp("activated_at", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("releases_project_version_unique").on(table.projectId, table.versionNumber),
    index("releases_project_status_idx").on(table.projectId, table.status),
  ],
);

export const deployments = pgTable(
  "deployments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    releaseId: uuid("release_id").notNull().references(() => releases.id),
    previousReleaseId: uuid("previous_release_id").references(() => releases.id),
    action: deploymentActionEnum("action").notNull(),
    status: deploymentStatusEnum("status").notNull().default("pending"),
    operatorId: uuid("operator_id").notNull().references(() => users.id),
    message: text("message"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => [
    index("deployments_project_created_at_idx").on(table.projectId, table.createdAt),
    index("deployments_release_id_idx").on(table.releaseId),
  ],
);

export const uploadTasks = pgTable(
  "upload_tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    releaseId: uuid("release_id").references(() => releases.id),
    status: uploadTaskStatusEnum("status").notNull().default("pending"),
    rawUploadPath: text("raw_upload_path").notNull(),
    originalFilename: varchar("original_filename", { length: 255 }).notNull(),
    size: bigint("size", { mode: "number" }).notNull().default(0),
    errorMessage: text("error_message"),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => [
    index("upload_tasks_project_status_idx").on(table.projectId, table.status),
    index("upload_tasks_release_id_idx").on(table.releaseId),
  ],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
    actorId: uuid("actor_id").references(() => users.id),
    action: varchar("action", { length: 120 }).notNull(),
    targetType: varchar("target_type", { length: 80 }).notNull(),
    targetId: uuid("target_id"),
    metadata: jsonb("metadata").notNull().default({}),
    ipAddress: varchar("ip_address", { length: 64 }),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("audit_logs_organization_created_at_idx").on(table.organizationId, table.createdAt),
    index("audit_logs_project_created_at_idx").on(table.projectId, table.createdAt),
  ],
);

export const webhooks = pgTable(
  "webhooks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    /** Destination URL — POSTed a signed JSON payload on matching events. */
    url: text("url").notNull(),
    /** Shared secret used to HMAC-sign deliveries (X-ZipShip-Signature). */
    secret: text("secret").notNull(),
    /** Subscribed events, e.g. ["release.published", "release.rolled_back"]. */
    events: text("events").array().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    index("webhooks_organization_id_idx").on(table.organizationId),
  ],
);
