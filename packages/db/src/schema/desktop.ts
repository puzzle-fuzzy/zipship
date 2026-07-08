import {
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import {
  clientTypeEnum,
  desktopLoginStatusEnum,
  desktopTicketStatusEnum,
  timestamps,
} from "./_shared";
import { organizations, users } from "./accounts";

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
