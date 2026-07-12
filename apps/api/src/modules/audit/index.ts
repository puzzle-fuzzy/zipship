/**
 * Audit module — internal (no HTTP routes). Records operations to the
 * `audit_logs` table for compliance/debugging.
 */
export { AuditService } from "./service";
export type { AuditRepository, AuditServiceOptions } from "./service";
export { createDrizzleAuditRepository } from "./drizzle-repository";
