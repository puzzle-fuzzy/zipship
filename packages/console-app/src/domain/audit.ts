export interface AuditLogEntry {
  id: string;
  action: string;
  actorId: string | null;
  targetType: string;
  targetId: string | null;
  projectId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}
