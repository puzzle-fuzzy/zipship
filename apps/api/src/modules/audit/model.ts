import { t } from "elysia";

export const auditMetadataModel = t.Record(t.String(), t.Unknown());

export const auditRecordInputModel = t.Object({
  organizationId: t.String(),
  projectId: t.Nullable(t.Optional(t.String())),
  actorId: t.Nullable(t.Optional(t.String())),
  action: t.String({ minLength: 1 }),
  targetType: t.String({ minLength: 1 }),
  targetId: t.Nullable(t.Optional(t.String())),
  metadata: t.Optional(auditMetadataModel),
  ipAddress: t.Nullable(t.Optional(t.String())),
  userAgent: t.Nullable(t.Optional(t.String())),
});

export const auditLogModel = t.Composite([
  auditRecordInputModel,
  t.Object({
    id: t.String(),
    projectId: t.Nullable(t.String()),
    actorId: t.Nullable(t.String()),
    targetId: t.Nullable(t.String()),
    metadata: auditMetadataModel,
    ipAddress: t.Nullable(t.String()),
    userAgent: t.Nullable(t.String()),
    createdAt: t.String(),
  }),
]);

export const auditModels = {
  "Audit.RecordInput": auditRecordInputModel,
  "Audit.Log": auditLogModel,
};

export type AuditMetadata = typeof auditMetadataModel.static;
export type AuditRecordInput = typeof auditRecordInputModel.static;
export type AuditLog = typeof auditLogModel.static;
export type AuditCreateInput = Omit<AuditLog, "id" | "createdAt"> & {
  createdAt: Date;
};
