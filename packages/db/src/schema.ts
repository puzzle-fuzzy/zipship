import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const userStatusEnum = pgEnum("user_status", ["active", "disabled"]);
export const organizationPlanEnum = pgEnum("organization_plan", ["free", "team", "enterprise"]);
export const memberRoleEnum = pgEnum("member_role", ["owner", "admin", "developer", "deployer", "viewer"]);
export const memberStatusEnum = pgEnum("member_status", ["active", "invited", "disabled"]);
export const invitationStatusEnum = pgEnum("invitation_status", ["pending", "accepted", "expired", "revoked"]);
export const projectStatusEnum = pgEnum("project_status", ["active", "archived"]);
export const projectVisibilityEnum = pgEnum("project_visibility", ["private", "organization"]);
export const releaseStatusEnum = pgEnum("release_status", [
  "uploading",
  "processing",
  "ready",
  "active",
  "failed",
  "archived",
  "deleted",
]);
export const deploymentActionEnum = pgEnum("deployment_action", ["publish", "rollback", "promote", "archive"]);
export const deploymentStatusEnum = pgEnum("deployment_status", ["pending", "success", "failed"]);
export const uploadTaskStatusEnum = pgEnum("upload_task_status", ["pending", "uploading", "processing", "completed", "failed"]);
export const clientTypeEnum = pgEnum("client_type", ["web", "desktop"]);
export const desktopLoginStatusEnum = pgEnum("desktop_login_status", ["pending", "authorized", "exchanged", "expired", "revoked"]);
export const desktopTicketStatusEnum = pgEnum("desktop_ticket_status", ["pending", "used", "expired", "revoked"]);

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: varchar("name", { length: 120 }).notNull(),
    email: varchar("email", { length: 255 }).notNull(),
    passwordHash: text("password_hash").notNull(),
    avatarUrl: text("avatar_url"),
    status: userStatusEnum("status").notNull().default("active"),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [uniqueIndex("users_email_unique").on(table.email)],
);

export const organizations = pgTable(
  "organizations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: varchar("name", { length: 160 }).notNull(),
    slug: varchar("slug", { length: 80 }).notNull(),
    ownerId: uuid("owner_id").notNull().references(() => users.id),
    plan: organizationPlanEnum("plan").notNull().default("free"),
    ...timestamps,
  },
  (table) => [uniqueIndex("organizations_slug_unique").on(table.slug), index("organizations_owner_id_idx").on(table.ownerId)],
);

export const members = pgTable(
  "members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    role: memberRoleEnum("role").notNull().default("developer"),
    status: memberStatusEnum("status").notNull().default("active"),
    joinedAt: timestamp("joined_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("members_organization_user_unique").on(table.organizationId, table.userId),
    index("members_organization_id_idx").on(table.organizationId),
    index("members_user_id_idx").on(table.userId),
  ],
);

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 160 }).notNull(),
    slug: varchar("slug", { length: 80 }).notNull(),
    description: text("description"),
    currentReleaseId: uuid("current_release_id"),
    status: projectStatusEnum("status").notNull().default("active"),
    visibility: projectVisibilityEnum("visibility").notNull().default("private"),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    ...timestamps,
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
    uniqueIndex("releases_project_release_hash_unique").on(table.projectId, table.releaseHash),
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

export const desktopDevices = pgTable(
  "desktop_devices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    deviceName: varchar("device_name", { length: 160 }).notNull(),
    deviceFingerprintHash: text("device_fingerprint_hash").notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("desktop_devices_fingerprint_unique").on(table.deviceFingerprintHash),
    index("desktop_devices_user_id_idx").on(table.userId),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    clientType: clientTypeEnum("client_type").notNull(),
    deviceId: uuid("device_id").references(() => desktopDevices.id, { onDelete: "set null" }),
    refreshTokenHash: text("refresh_token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("sessions_refresh_token_hash_unique").on(table.refreshTokenHash),
    index("sessions_user_id_idx").on(table.userId),
    index("sessions_device_id_idx").on(table.deviceId),
  ],
);

export const desktopLoginRequests = pgTable(
  "desktop_login_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    deviceId: uuid("device_id").notNull().references(() => desktopDevices.id, { onDelete: "cascade" }),
    state: varchar("state", { length: 160 }).notNull(),
    codeChallenge: text("code_challenge").notNull(),
    status: desktopLoginStatusEnum("status").notNull().default("pending"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    authorizedBy: uuid("authorized_by").references(() => users.id),
    authorizationCodeHash: text("authorization_code_hash"),
    authorizedAt: timestamp("authorized_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("desktop_login_requests_state_unique").on(table.state),
    index("desktop_login_requests_device_id_idx").on(table.deviceId),
  ],
);

export const desktopLoginTickets = pgTable(
  "desktop_login_tickets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    ticketHash: text("ticket_hash").notNull(),
    status: desktopTicketStatusEnum("status").notNull().default("pending"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    deviceId: uuid("device_id").references(() => desktopDevices.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("desktop_login_tickets_ticket_hash_unique").on(table.ticketHash),
    index("desktop_login_tickets_user_id_idx").on(table.userId),
    index("desktop_login_tickets_organization_id_idx").on(table.organizationId),
  ],
);
